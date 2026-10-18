import { type ConversationId, defineDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  end,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

const TaskNotes = defineDoc<{ text: string }>({
  kind: "test.task-notes",
  version: 1,
  scope: "task",
  initial: () => ({ text: "" }),
});

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

const holdsFinishedTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let child: TaskId | undefined;
  script("parent", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    (yield* awaited(tx.doc(TaskNotes, runtime.taskId))).text = "notes";
                    child = yield* awaited(spawn(tx, runtime.taskId, "child"));
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "completing";
      }),
    ),
  );
  expect(yield* state(harness, parent)).toEqual({
    status: "completing",
    outcome: { status: "completed", result: "parent" },
  });
  const waiter = harness.waitForTask(parent, context);
  expect(yield* settled(waiter)).toBe(false);
  expect(yield* awaited(harness.snapshot(TaskNotes, parent, context))).toEqual({
    text: "notes",
  });
  expect(
    (yield* awaited(harness.inspect(context))).tasks.find((task) => task.record.id === parent)
      ?.state,
  ).toEqual({
    kind: "completing",
  });
  expect(yield* settled(root.waitForIdle(context))).toBe(false);
  open("child");
  expect((yield* awaited(waiter)).state.outcome).toEqual({
    status: "completed",
    result: "parent",
  });
  expect(yield* awaited(harness.snapshot(TaskNotes, parent, context))).toBeUndefined();
  yield* awaited(root.waitForIdle(context));
  expect(child).toBeDefined();
  yield* awaited(harness.close(context));
});

describe("completing", () => {
  it("holds a finished task until its owned work drains; waiters and task documents wait for the final commit", () =>
    Effect.runPromise(holdsFinishedTask));
});

const keepsHoldingOrdinaryStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  return { runPromise, harness, root };
});

const keepsHoldingOrdinaryStep2 = Effect.gen(function* () {
  const { runPromise, harness, root } = yield* keepsHoldingOrdinaryStep1;
  let conversation: ConversationId | undefined;
  script("parent", {
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
                    yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "first" },
                        { ...OWN_CONVERSATION, conversationId: conversation },
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
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "completing";
      }),
    ),
  );
  const child = (yield* awaited(harness.conversation(conversation!, context)))!;
  return { harness, parent, child };
});

const keepsHoldingOrdinary = Effect.gen(function* () {
  const { harness, parent, child } = yield* keepsHoldingOrdinaryStep2;
  yield* awaited(start(child, "second"));
  open("first");
  yield* until(() => log.includes("run:second"));
  expect((yield* state(harness, parent)).status).toBe("completing");
  open("second");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe("completed");
  yield* awaited(harness.close(context));
});

describe("completing", () => {
  it("keeps holding for ordinary work created during the hold", () =>
    Effect.runPromise(keepsHoldingOrdinary));
});

describe("completing", () => {
  for (const [label, ending] of [
    ["a held failure", "failed"],
    ["a held scheduler fault", "throw"],
  ] as const) {
    it(`aborts the work below ${label}, then finishes with the held outcome`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const { harness, root } = yield* openNodes();
          let child: TaskId | undefined;
          script("parent", {
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
                            return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                          }),
                        ),
                      ctx,
                    ),
                  );
                }),
              ),
            resume: (runtime, ctx) =>
              runPromise(
                Effect.gen(function* () {
                  if (ending === "throw") throw new Error("parent threw");
                  yield* awaited(runtime.commit(() => end("failed", "parent"), ctx));
                }),
              ),
          });
          const parent = yield* awaited(start(root, "parent"));
          yield* until(() => child !== undefined);
          expect(yield* awaited(outcomeOf(harness, child!))).toBe("aborted");
          expect(yield* awaited(outcomeOf(harness, parent))).toBe(
            ending === "throw" ? "faulted" : "failed",
          );
          yield* awaited(harness.close(context));
        }),
      ));
  }
});

const onlyMarksCompleting = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let child: TaskId | undefined;
  script("parent", {
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
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, parent)).status === "completing";
      }),
    ),
  );
  expect(yield* awaited(harness.abortTask(parent, context))).toBe("marked");
  expect(yield* awaited(outcomeOf(harness, child!))).toBe("aborted");
  const settledParent = yield* awaited(harness.waitForTask(parent, context));
  expect(settledParent.state.outcome).toEqual({ status: "completed", result: "parent" });
  expect(settledParent.abortRequested).toBe(true);
  expect(log).not.toContain("abort:parent");
  expect(yield* awaited(harness.abortTask(parent, context))).toBe("terminal");
  yield* awaited(harness.close(context));
});

describe("completing", () => {
  it("only marks a completing task when aborted: the work below is aborted, the held outcome stays", () =>
    Effect.runPromise(onlyMarksCompleting));
});
