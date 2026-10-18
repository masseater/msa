import type { Context } from "@msa/chord";
import {
  defineDoc,
  defineEntry,
  defineTask,
  type EntryId,
  type TaskId,
  type TaskRuntime,
} from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { user } from "./harness-support.ts";
import { oneStep, openRoot } from "./harness-tasks-support.ts";
import { context } from "./session-support.ts";
import { completed } from "./task-support.ts";

const Progress = defineDoc<{ lines: string[] }>({
  kind: "test.task-progress",
  version: 1,
  scope: "task",
  initial: () => ({ lines: [] }),
});

const Answer = defineEntry("answer");

const Child = oneStep("test.child", (_task, runtime, ctx) =>
  runtime.commit(() => completed(null), ctx).then(() => undefined),
);

const checkMemos = Effect.fn("checkMemos")(function* (runtime: MemoRuntime, ctx: Context) {
  expect(yield* awaited(runtime.memo("choice", ctx))).toBeUndefined();
  const winners = yield* awaited(
    Promise.all([runtime.memo("choice", "a", ctx), runtime.memo("choice", "b", ctx)]),
  );
  expect(winners).toEqual(["a", "a"]);
  expect(yield* awaited(runtime.memo("choice", ctx))).toBe("a");
  expect(yield* awaited(runtime.memo("toString", ctx))).toBeUndefined();
  expect(yield* awaited(runtime.memo("toString", "own", ctx))).toBe("own");
});

type MemoRuntime = Pick<TaskRuntime<null, { phase: string }, never, object>, "memo">;

const seen: { childId?: TaskId; progressSeen?: unknown } = {};
const Writer = defineTask<null, { phase: "write" } | { phase: "answer" }, { entryId: EntryId }>({
  name: "test.writer",
  version: 1,
  initial: () => ({ phase: "write" }),
  phases: {
    write: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* checkMemos(runtime, ctx);
          yield* awaited(
            runtime.commit(
              (tx) =>
                tx
                  .doc(Progress, task.id)
                  .then((progress) => {
                    progress.lines.push("wrote");
                    return tx.createTask(Child, null, { ownership: { kind: "conversation" } });
                  })
                  .then((childId) => {
                    seen.childId = childId;
                    return { status: "running", checkpoint: { phase: "answer" } } as const;
                  }),
              ctx,
            ),
          );
        }),
      ),
    answer: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          expect(task.memos).toEqual({ choice: "a", toString: "own" });
          yield* awaited(
            runtime.commit(
              (tx) =>
                tx.doc(Progress, task.id).then((progress) => {
                  seen.progressSeen = [...progress.lines];
                  return undefined;
                }),
              ctx,
            ),
          );
          yield* awaited(
            runtime.commit(
              (tx, current) =>
                tx
                  .appendEntry(current.conversationId, { kind: "answer", model: [user("done")] })
                  .then((entry) => completed({ entryId: entry.id })),
              ctx,
            ),
          );
        }),
      ),
  },
  abort: () => Promise.resolve(),
});

const commitsResultsEntries = Effect.gen(function* () {
  const { harness, root } = yield* openRoot([Writer, Child]);
  const conversation = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const id = yield* awaited(
    conversation.commit(
      (tx) => tx.createTask(Writer, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  const receipt = yield* awaited(harness.waitForTask(id, context));
  expect(receipt.state).not.toHaveProperty("checkpoint");
  expect(receipt).not.toHaveProperty("memos");
  const outcome = receipt.state.outcome;
  if (outcome.status !== "completed") throw new Error("expected completion");
  const entry = yield* awaited(harness.commit((tx) => tx.entry(outcome.result.entryId), context));
  expect(Answer.is(entry)).toBe(true);
  expect(entry?.conversationId).toBe(conversation.id);
  expect(seen.progressSeen).toEqual(["wrote"]);
  expect(yield* awaited(harness.snapshot(Progress, id, context))).toBeUndefined();
  expect(yield* awaited(harness.getTask(id, context))).toEqual(receipt);
  expect((yield* awaited(harness.waitForTask(seen.childId!, context))).conversationId).toBe(
    conversation.id,
  );
  expect(root.id).not.toBe(conversation.id);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("commits results with entries atomically, keeps memos until terminal, and retires task documents", () =>
    Effect.runPromise(commitsResultsEntries));
});
