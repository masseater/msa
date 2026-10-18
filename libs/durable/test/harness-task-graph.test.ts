import type { JsonValue } from "@msa/chord";
import { applyImmutable, type Op } from "@msa/chord/delta";
import {
  type ConversationId,
  defineTask,
  type EntryId,
  type TaskGraph,
  type TaskId,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import { statuses, family } from "./harness-task-graph-support.ts";
import { joinPath, makeTempDir, removeDir } from "./platform-support.ts";
import { context, flush } from "./session-support.ts";
import { aborted, completed, deferred, eventually, openTasks } from "./task-support.ts";

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
  return { seen, view, rebuild, childId };
});

function expectPendingParent(graph: TaskGraph, parent: TaskId, conversationId: ConversationId) {
  expect(graph.tasks[String(parent)]).toEqual({
    id: parent,
    kind: "test.graph-parent",
    conversationId,
    background: false,
    abortRequested: false,
    state: { status: "pending", phase: "spawn" },
    conversations: [],
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
    status: "waiting",
    phase: "join",
    on: [first],
    policy: "allSettled",
  });
  expect(parentNode.conversations).toHaveLength(2);
  expect([...parentNode.conversations].sort((a, b) => a - b)).toEqual(parentNode.conversations);
  expect(graph.tasks[String(first)]).toMatchObject({ owner: parent, conversationId });
  return { first, parentNode };
}

function expectDistinctRevisions(seen: readonly TaskGraph[], parent: TaskId) {
  for (let index = 1; index < seen.length; index++)
    expect(seen[index]).not.toEqual(seen[index - 1]);
  expect(seen.some((value) => value.tasks[String(parent)]?.conversations.length === 2)).toBe(true);
}

const committedGraphTasks = Effect.fn("committedGraphTasks")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-graph-");
  const path = joinPath(directory, "session.sqlite");
  const gate = deferred();
  const Work = defineTask<null, { phase: "work" }, null>({
    name: "test.graph-work",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(Promise.race([gate.promise, aborted(runtime.signal)]));
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: (_task, runtime, ctx) =>
      runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted", reason: "test" } }),
                ctx,
              ),
            ),
          ),
        ),
      ),
  });
  const first = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Work]);
  const firstRoot = yield* awaited(first.harness.root(context));
  const [foreground, background, owned] = yield* awaited(
    firstRoot.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const foreground = yield* awaited(
              tx.createTask(Work, null, { ownership: { kind: "conversation" } }),
            );
            const background = yield* awaited(
              tx.createTask(Work, null, {
                ownership: { kind: "conversation" },
                background: true,
              }),
            );
            const owned = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: foreground },
              }),
            );
            return [foreground, background, owned.id] as const;
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
  return { directory, path, gate, Work, foreground, background, owned };
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
    status: "completing",
    outcome: "completed",
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

const listsOwnedConversations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const gate = deferred();
  const created: number[] = [];
  const Spawner = defineTask<{ at: EntryId }, { phase: "spawn" }, null>({
    name: "test.graph-spawner",
    version: 1,
    initial: () => ({ phase: "spawn" }),
    phases: {
      spawn: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            yield* awaited(
              runtime.commit(
                (tx) =>
                  runPromise(
                    Effect.gen(function* () {
                      const ownership = { kind: "task", taskId: task.id } as const;
                      const [forked, fresh] = yield* awaited(
                        Promise.all([
                          tx.forkConversation(runtime.conversationId, task.input.at, {
                            ownership,
                          }),
                          tx.createConversation({ ownership }),
                        ]),
                      );
                      created.push(forked.id, fresh.id);
                      return undefined;
                    }),
                  ),
                ctx,
              ),
            );
            yield* awaited(gate.promise);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  const { harness } = yield* openTasks(new MemoryStorage(), [Spawner]);
  const root = yield* awaited(harness.root(context));
  const graph = yield* awaited(harness.taskGraph(context));
  const id = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const entry = yield* awaited(tx.appendEntry(root.id, { kind: "note" }));
            return yield* awaited(
              tx.createTask(Spawner, { at: entry.id }, { ownership: { kind: "conversation" } }),
            );
          }),
        ),
      context,
    ),
  );
  harness.resume();
  yield* eventually(() => (graph.value.tasks[String(id)]?.conversations.length ?? 0) === 2);
  const advanced = graph.value;
  expect(advanced.tasks[String(id)]!.conversations).toEqual([...created].sort((a, b) => a - b));
  graph.dispose();
  const rebuilt = yield* awaited(harness.taskGraph(context));
  expect(rebuilt.value).toEqual(advanced);
  rebuilt.dispose();
  gate.resolve();
  yield* awaited(harness.waitForTask(id, context));
  yield* awaited(harness.close(context));
});

describe("task graph view", () => {
  it("lists owned conversations in ID order whatever order one commit creates them in", () =>
    Effect.runPromise(listsOwnedConversations));
});
