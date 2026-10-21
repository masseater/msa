import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const {
  Node,
  OWN_CONVERSATION,
  behaviors,
  directories,
  end,
  gates,
  log,
  open,
  openNodes,
  outcomeOf,
  script,
  spawn,
  start,
  state,
  until,
} = harnessStructuredSupport;
const { removeDir } = platformSupport;
const { context } = sessionSupport;
const { settled } = taskSupport;

const TaskNotes = defineDoc<{ text: string }>({
  initial: () => ({ text: "" }),
  kind: "test.task-notes",
  scope: "task",
  version: 1,
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
  const { harness, root } = yield* openNodes();
  let child: durableTypes.TaskId | undefined;
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          tx
            .doc(TaskNotes, runtime.taskId)
            .then((notes) => {
              notes.text = "notes";
              return spawn(tx, runtime.taskId, "child");
            })
            .then((spawned) => {
              child = spawned;
              return { checkpoint: { phase: "resume", round: 1 }, status: "running" } as const;
            }),
        ctx,
      ),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(Effect.map(state(harness, parent), (current) => current.status === "completing"));
  expect(yield* state(harness, parent)).toEqual({
    outcome: { result: "parent", status: "completed" },
    status: "completing",
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
    result: "parent",
    status: "completed",
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
  return { harness, root, runPromise };
});

const keepsHoldingOrdinaryStep2 = Effect.gen(function* () {
  const { runPromise, harness, root } = yield* keepsHoldingOrdinaryStep1;
  let conversation: durableTypes.ConversationId | undefined;
  script("parent", {
    run: (runtime, ctx) =>
      runtime
        .commit(
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
                return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
              }),
            ),
          ctx,
        )
        .then(() => undefined),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "completing";
    }),
  );
  const child = (yield* awaited(harness.conversation(conversation!, context)))!;
  return { child, harness, parent };
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

const abortsWorkBelowCases = [
  ["a held failure", "failed"],
  ["a held scheduler fault", "throw"],
] as const;

const abortsWorkBelow = Effect.fn("abortsWorkBelow")(function* (
  ending: (typeof abortsWorkBelowCases)[number][1],
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let child: durableTypes.TaskId | undefined;
  script("parent", {
    resume: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          if (ending === "throw") throw new Error("parent threw");
          yield* awaited(runtime.commit(() => end("failed", "parent"), ctx));
        }),
      ),
    run: (runtime, ctx) =>
      runtime
        .commit(
          (tx) =>
            runPromise(
              Effect.gen(function* () {
                child = yield* awaited(spawn(tx, runtime.taskId, "child"));
                return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
              }),
            ),
          ctx,
        )
        .then(() => undefined),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(() => child !== undefined);
  expect(yield* awaited(outcomeOf(harness, child!))).toBe("aborted");
  expect(yield* awaited(outcomeOf(harness, parent))).toBe(
    ending === "throw" ? "faulted" : "failed",
  );
  yield* awaited(harness.close(context));
});

describe("completing", () => {
  for (const [label, ending] of abortsWorkBelowCases) {
    it(`aborts the work below ${label}, then finishes with the held outcome`, () =>
      Effect.runPromise(abortsWorkBelow(ending)));
  }
});

const onlyMarksCompleting = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openNodes();
  let child: durableTypes.TaskId | undefined;
  script("parent", {
    run: (runtime, ctx) =>
      runtime
        .commit(
          (tx) =>
            runPromise(
              Effect.gen(function* () {
                child = yield* awaited(spawn(tx, runtime.taskId, "child"));
                return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
              }),
            ),
          ctx,
        )
        .then(() => undefined),
  });
  const parent = yield* awaited(start(root, "parent"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "completing";
    }),
  );
  expect(yield* awaited(harness.abortTask(parent, context))).toBe("marked");
  expect(yield* awaited(outcomeOf(harness, child!))).toBe("aborted");
  const settledParent = yield* awaited(harness.waitForTask(parent, context));
  expect(settledParent.state.outcome).toEqual({ result: "parent", status: "completed" });
  expect(settledParent.abortRequested).toBe(true);
  expect(log).not.toContain("abort:parent");
  expect(yield* awaited(harness.abortTask(parent, context))).toBe("terminal");
  yield* awaited(harness.close(context));
});

describe("completing", () => {
  it("only marks a completing task when aborted: the work below is aborted, the held outcome stays", () =>
    Effect.runPromise(onlyMarksCompleting));
});
