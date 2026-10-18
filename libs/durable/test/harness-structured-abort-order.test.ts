import { type ConversationId, type Harness, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gate,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  type Opened,
  Unregistered,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function chain(harness: () => Harness, name: string, child: string): { id?: TaskId } {
  const found: { id?: TaskId } = {};
  script(name, {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          Effect.runPromise(
            Effect.gen(function* () {
              found.id = yield* awaited(spawn(tx, runtime.taskId, child));
              return waitOn([found.id], "allSettled");
            }),
          ),
        ctx,
      ),
    abort: (runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          log.push(
            `${name} saw ${(yield* awaited(harness().getTask(found.id!, context)))!.state.status}`,
          );
          yield* awaited(
            runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
          );
        }),
      ),
  });
  return found;
}

const runsAbortHandlers = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let opened: Opened | undefined;
  const b = chain(() => opened!.harness, "a", "b");
  const c = chain(() => opened!.harness, "b", "c");
  opened = yield* openNodes();
  const { harness, root } = opened;
  const a = yield* awaited(start(root, "a"));
  yield* until(() => log.includes("run:c"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, c.id!)).status === "running";
      }),
    ),
  );
  expect(yield* awaited(harness.abortTask(a, context))).toBe("marked");
  expect(yield* awaited(outcomeOf(harness, a))).toBe("aborted");
  expect(log.filter((line) => line.startsWith("abort:") || line.includes(" saw "))).toEqual([
    "abort:c",
    "abort:b",
    "b saw terminal",
    "abort:a",
    "a saw terminal",
  ]);
  expect(b.id).toBeDefined();
  yield* awaited(harness.close(context));
});

const doesNotWait = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const other = yield* awaited(start(root, "other"));
  script("parent", {
    run: (runtime, ctx) => runtime.commit(() => waitOn([other], "allSettled"), ctx),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "waiting";
      }),
    ),
  );
  yield* awaited(harness.abortTask(parent, context));
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("aborted");
  expect((yield* state(harness, other)).status).toBe("running");
  open("other");
  yield* awaited(harness.close(context));
});

describe("abort order", () => {
  it("runs abort handlers bottom-up across three levels, each after the level below is terminal", () =>
    Effect.runPromise(runsAbortHandlers));

  it("does not wait for a task it waits on but does not own", () => Effect.runPromise(doesNotWait));
});

const reportsAbortMarked = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let child: TaskId | undefined;
  script("child", {
    abort: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(gate("abort.child").promise);
          yield* awaited(
            runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
          );
        }),
      ),
  });
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              child = yield* awaited(spawn(tx, runtime.taskId, "child"));
              return waitOn([child], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "waiting";
      }),
    ),
  );
  yield* awaited(harness.abortTask(parent, context));
  yield* until(() => log.includes("abort:child"));
  const inspected = (yield* awaited(harness.inspect(context))).tasks.find(
    (task) => task.record.id === parent,
  );
  expect(inspected?.state).toEqual({ kind: "waiting", on: [child] });
  open("abort.child");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("aborted");
  yield* awaited(harness.close(context));
});

const faultsAbortHandler = Effect.gen(function* () {
  const { harness, root } = yield* openNodes();
  script("parent", {
    abort: (runtime, ctx) => runtime.commit(() => waitOn([], "allSettled"), ctx),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => log.includes("run:parent"));
  yield* awaited(harness.abortTask(parent, context));
  expect((yield* awaited(harness.waitForTask(parent, context))).state.outcome).toMatchObject({
    status: "faulted",
    error: { message: expect.stringContaining("cannot wait") },
  });
  yield* awaited(harness.close(context));
});

describe("abort order", () => {
  it("reports an abort-marked task as waiting for its live owned work", () =>
    Effect.runPromise(reportsAbortMarked));

  it("faults an abort handler that tries to wait", () => Effect.runPromise(faultsAbortHandler));
});

const orphansBlockedTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const { owner, child } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const owner = yield* awaited(
              tx.createTask(Unregistered, { name: "owner" }, OWN_CONVERSATION),
            );
            return { owner, child: yield* awaited(spawn(tx, owner, "child")) };
          }),
        ),
      context,
    ),
  );
  yield* until(() => log.includes("run:child"));
  expect(yield* awaited(harness.abortTask(owner, context))).toBe("marked");
  expect(yield* awaited(outcomeOf(harness, child))).toBe("aborted");
  expect((yield* awaited(harness.waitForTask(owner, context))).state.outcome).toEqual({
    status: "orphaned",
    reason: "missing_task",
  });
  yield* awaited(harness.close(context));
});

describe("abort order", () => {
  it("orphans a blocked task only after its owned work drained", () =>
    Effect.runPromise(orphansBlockedTask));
});

const cascadesThroughTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let b: TaskId | undefined;
  let x: TaskId | undefined;
  script("a", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              b = yield* awaited(spawn(tx, runtime.taskId, "b"));
              return waitOn([b], "allSettled");
            }),
          ),
        ctx,
      ),
  });
  script("b", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    const conversation = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    );
                    x = yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "x" },
                        { ...OWN_CONVERSATION, conversationId: conversation.id },
                      ),
                    );
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
    resume: (runtime) => runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  });
  const a = yield* awaited(start(root, "a"));
  yield* until(() => log.includes("run:x"));
  yield* awaited(harness.abortTask(a, context));
  expect(yield* awaited(outcomeOf(harness, a))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, x!))).toBe("aborted");
  expect(log.filter((line) => line.startsWith("abort:"))).toEqual([
    "abort:x",
    "abort:b",
    "abort:a",
  ]);
  yield* awaited(harness.close(context));
});

describe("abort order", () => {
  it("cascades through task and conversation edges, bottom-up", () =>
    Effect.runPromise(cascadesThroughTask));
});

const keepsBackgroundWork = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  const foreground = yield* awaited(start(root, "foreground"));
  let child: TaskId | undefined;
  let below: TaskId | undefined;
  script("background", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    child = yield* awaited(spawn(tx, runtime.taskId, "child"));
                    const conversation = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    );
                    below = yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "below" },
                        { ...OWN_CONVERSATION, conversationId: conversation.id },
                      ),
                    );
                    return waitOn([child], "allSettled");
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  const background = yield* awaited(
    start(root, "background", { ...OWN_CONVERSATION, background: true }),
  );
  yield* until(() => log.includes("run:below") && log.includes("run:child"));
  yield* awaited(root.abort(context));
  expect(yield* awaited(outcomeOf(harness, foreground))).toBe("aborted");
  for (const id of [background, child!, below!])
    expect((yield* state(harness, id)).status).not.toBe("terminal");
  yield* awaited(root.abort(context, { background: true }));
  for (const id of [background, child!, below!])
    expect((yield* state(harness, id)).status).toBe("terminal");
  yield* awaited(harness.close(context));
});

describe("boundaries", () => {
  it("keeps background work through Conversation.abort(); { background: true } aborts it and waits", () =>
    Effect.runPromise(keepsBackgroundWork));
});

const neverCascadesTerminal = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let conversation: ConversationId | undefined;
  script("agent", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    conversation = (yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    )).id;
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
    resume: (runtime) => runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
  });
  const agent = yield* awaited(start(root, "agent"));
  yield* until(() => log.includes("resume:agent"));
  yield* awaited(harness.abortTask(agent, context));
  expect(yield* awaited(outcomeOf(harness, agent))).toBe("aborted");
  const child = (yield* awaited(harness.conversation(conversation!, context)))!;
  const question = yield* awaited(start(child, "question"));
  open("question");
  expect(yield* awaited(outcomeOf(harness, question))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("boundaries", () => {
  it("never cascades from a terminal owner: an aborted subagent's conversation runs new work normally", () =>
    Effect.runPromise(neverCascadesTerminal));
});
