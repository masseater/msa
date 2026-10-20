import type { JsonValue } from "@msa/chord";
import { type Op, applyImmutable } from "@msa/chord/delta";
import { type ConversationId, type TaskGraph, type TaskId, defineTask } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import harnessTaskGraphSupport from "./harness-task-graph-support.ts";
import support from "./support.ts";

const { family, statuses } = harnessTaskGraphSupport;
const {
  aborted,
  awaited,
  completed,
  context,
  deferred,
  eventually,
  flush,
  joinPath,
  makeTempDir,
  openTasks,
  removeDir,
} = support;

type GraphHarness = Effect.Success<ReturnType<typeof openTasks>>["harness"];

const observedGraph = Effect.fn("observedGraph")(function* (harness: GraphHarness) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const seen: TaskGraph[] = [];
  const observe = () =>
    runPromise(
      Effect.gen(function* () {
        const opened = yield* awaited(harness.taskGraph(context));
        opened.subscribe((value, _context, delivery) => {
          if (delivery.kind === "update") seen.push(value);
        });
        return opened;
      }),
    );
  const view = { graph: yield* awaited(observe()) };
  const rebuild = () =>
    runPromise(
      Effect.gen(function* () {
        const advanced = view.graph.value;
        view.graph.dispose();
        view.graph = yield* awaited(observe());
        expect(view.graph.value).not.toBe(advanced);
        expect(view.graph.value).toEqual(advanced);
      }),
    );
  const childId = (): string =>
    Object.values(view.graph.value.tasks)
      .find((node) => node.kind === "test.graph-child")
      ?.id.toString() ?? "";
  return { childId, rebuild, seen, view };
});

function expectPendingParent(graph: TaskGraph, parent: TaskId, conversationId: ConversationId) {
  expect(graph.tasks[String(parent)]).toEqual({
    abortRequested: false,
    background: false,
    conversationId,
    conversations: [],
    id: parent,
    kind: "test.graph-parent",
    state: { phase: "spawn", status: "pending" },
  });
}

function expectWaitingParent(
  graph: TaskGraph,
  parent: TaskId,
  conversationId: ConversationId,
  childId: string,
) {
  const first = Number(childId) as TaskId;
  const parentNode = graph.tasks[String(parent)]!;
  expect(parentNode.state).toEqual({
    on: [first],
    phase: "join",
    policy: "allSettled",
    status: "waiting",
  });
  expect(parentNode.conversations).toHaveLength(2);
  expect([...parentNode.conversations].sort((a, b) => a - b)).toEqual(parentNode.conversations);
  expect(graph.tasks[String(first)]).toMatchObject({ conversationId, owner: parent });
  return { first, parentNode };
}

function expectDistinctRevisions(seen: readonly TaskGraph[], parent: TaskId) {
  for (let index = 1; index < seen.length; index++)
    expect(seen[index]).not.toEqual(seen[index - 1]);
  expect(seen.some((value) => value.tasks[String(parent)]?.conversations.length === 2)).toBe(true);
}

const committedGraphTasksStep1 = Effect.fn("committedGraphTasksStep1")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-graph-");
  const path = joinPath(directory, "session.sqlite");
  const gate = deferred();
  const Work = defineTask<null, { phase: "work" }, null>({
    abort: (_task, runtime, ctx) =>
      runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ outcome: { reason: "test", status: "aborted" }, status: "terminal" }),
                ctx,
              ),
            ),
          ),
        ),
      ),
    initial: () => ({ phase: "work" }),
    name: "test.graph-work",
    phases: {
      work: (_task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(Promise.race([gate.promise, aborted(runtime.signal)]));
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    version: 1,
  });
  const first = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Work]);
  const firstRoot = yield* awaited(first.harness.root(context));
  return { Work, directory, first, firstRoot, gate, path, runPromise };
});

const committedGraphTasks = Effect.fn("committedGraphTasks")(function* () {
  const { runPromise, directory, path, gate, Work, first, firstRoot } =
    yield* committedGraphTasksStep1();
  const [foreground, background, owned] = yield* awaited(
    firstRoot.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const foregroundInner = yield* awaited(
              tx.createTask(Work, null, { ownership: { kind: "conversation" } }),
            );
            const backgroundInner = yield* awaited(
              tx.createTask(Work, null, {
                background: true,
                ownership: { kind: "conversation" },
              }),
            );
            const ownedInner = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: foregroundInner },
              }),
            );
            return [foregroundInner, backgroundInner, ownedInner.id] as const;
          }),
        ),
      context,
    ),
  );
  first.harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(first.harness.inspect(context))).tasks.every(
          (task) => task.state.kind === "running",
        );
      }),
    ),
  );
  const running = yield* awaited(first.harness.taskGraph(context));
  expect(statuses(running.value)).toEqual({
    [`test.graph-work#${foreground}`]: "running",
    [`test.graph-work#${background}`]: "running",
  });
  yield* awaited(first.harness.close(context));
  return { Work, background, directory, foreground, gate, owned, path };
});

const followsEveryLive = Effect.gen(function* () {
  const child = deferred();
  const late = deferred();
  const { Parent, Child } = family({ child: child.promise, late: late.promise });
  const { harness } = yield* openTasks(new MemoryStorage(), [Parent, Child]);
  const root = yield* awaited(harness.root(context));
  const { seen, view, rebuild, childId } = yield* observedGraph(harness);
  expect(view.graph.value).toEqual({ tasks: {} });

  const parent = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Parent, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  yield* flush;
  expectPendingParent(view.graph.value, parent, root.id);

  harness.resume();
  yield* eventually(
    () =>
      Object.keys(view.graph.value.tasks).length === 2 &&
      statuses(view.graph.value)[`test.graph-child#${childId()}`] === "running",
  );
  const { first, parentNode } = expectWaitingParent(view.graph.value, parent, root.id, childId());
  expect(
    (yield* awaited(harness.conversation(parentNode.conversations[0]!, context))) !== undefined,
  ).toBe(true);
  yield* awaited(rebuild());

  child.resolve();
  yield* eventually(() => view.graph.value.tasks[String(parent)]?.state.status === "completing");
  expect(view.graph.value.tasks[String(parent)]!.state).toEqual({
    outcome: "completed",
    status: "completing",
  });
  expect(view.graph.value.tasks[String(first)]).toBeUndefined();
  expect(view.graph.value.tasks[String(parent)]!.conversations).toEqual(parentNode.conversations);
  yield* awaited(rebuild());

  late.resolve();
  yield* awaited(harness.waitForTask(parent, context));
  yield* flush;
  expect(view.graph.value).toEqual({ tasks: {} });
  expectDistinctRevisions(seen, parent);
  view.graph.dispose();
  yield* awaited(harness.close(context));
});

describe("task graph view", () => {
  it("follows every live task through its statuses, owner edges, and owned conversations", () =>
    Effect.runPromise(followsEveryLive));
});

const buildsCommittedTasks = Effect.gen(function* () {
  const { directory, path, gate, Work, foreground, background, owned } =
    yield* committedGraphTasks();

  const { harness } = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Work]);
  const watch = yield* awaited(harness.watchTaskGraph(context));
  expect(statuses(watch.value)).toEqual({
    [`test.graph-work#${foreground}`]: "pending",
    [`test.graph-work#${background}`]: "pending",
  });
  expect(watch.value.tasks[String(foreground)]!.conversations).toEqual([owned as ConversationId]);
  expect(watch.value.tasks[String(background)]!.background).toBe(true);

  const mirror: { replica: JsonValue } = { replica: watch.value as unknown as JsonValue };
  const frames: (readonly Op[])[] = [];
  watch.start((value, ops) => {
    mirror.replica = applyImmutable(mirror.replica, ops);
    expect(mirror.replica).toEqual(value);
    frames.push(ops);

    return Promise.resolve();
  });
  harness.resume();
  yield* eventually(() => watch.value.tasks[String(background)]?.state.status === "running");
  expect(yield* awaited(harness.abortTask(background, context))).toBe("marked");
  yield* awaited(harness.waitForTask(background, context));
  yield* flush;
  expect(frames).toContainEqual([
    ["s", ["tasks", String(background)], expect.objectContaining({ abortRequested: true })],
  ]);
  expect(frames.at(-1)).toEqual([["d", ["tasks", String(background)]]]);
  expect(Object.keys((mirror.replica as unknown as TaskGraph).tasks)).toEqual([String(foreground)]);
  yield* awaited(watch.stop());
  gate.resolve();
  yield* awaited(harness.waitForTask(foreground, context));
  yield* awaited(harness.close(context));
  yield* removeDir(directory);
});

describe("task graph view", () => {
  it("builds from committed tasks, shows surviving tasks as pending after reopen, and marks aborts", () =>
    Effect.runPromise(buildsCommittedTasks));
});
