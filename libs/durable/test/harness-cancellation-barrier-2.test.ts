import { defineTask } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { Dormant } from "./harness-cancellation-barrier-cases.ts";
import { context } from "./session-support.ts";
import { eventually, openTasks } from "./task-support.ts";

const restartMarkedTree = Effect.fn("restartMarkedTree")(function* () {
  const storage = new MemoryStorage();
  const session = createSession(storage);
  const conversation = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  const top = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          conversationId: conversation.id,
          ownership: { kind: "conversation" },
        }),
      context,
    ),
  );
  const middle = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          ownership: { kind: "task", taskId: top },
          abandonOnRestart: true,
        }),
      context,
    ),
  );
  const Missing = defineTask<null, { phase: "work" }, null>({
    ...Dormant.definition,
    name: "test.missing",
  });
  const leaf = yield* awaited(
    session.commit(
      (tx) => tx.createTask(Missing, null, { ownership: { kind: "task", taskId: middle } }),
      context,
    ),
  );
  return { storage, top, middle, leaf };
});

const upgradesRestartMarks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { storage, top, middle, leaf } = yield* restartMarkedTree();
  const { harness } = yield* openTasks(storage, [Dormant]);
  yield* Effect.gen(function* () {
    harness.resume();
    yield* eventually(() =>
      runPromise(
        Effect.gen(function* () {
          return (yield* awaited(harness.getTask(leaf, context)))?.abortReason === "restart";
        }),
      ),
    );
    yield* eventually(() =>
      runPromise(
        Effect.gen(function* () {
          const inspected = (yield* awaited(harness.inspect(context))).tasks.find(
            (task) => task.record.id === leaf,
          );
          return inspected?.state.kind === "blocked";
        }),
      ),
    );
    expect((yield* awaited(harness.getTask(leaf, context)))?.state.status).not.toBe("terminal");
    yield* awaited(harness.abortTask(top, context));
    for (const [id, status] of [
      [leaf, "orphaned"],
      [middle, "aborted"],
      [top, "aborted"],
    ] as const) {
      expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe(status);
    }
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("work below a cancelled owner", () => {
  it("upgrades restart marks down the tree when an abort is requested above them", () =>
    Effect.runPromise(upgradesRestartMarks));
});

const marksFlaggedTask = Effect.gen(function* () {
  const storage = new MemoryStorage();
  const session = createSession(storage);
  const conversation = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  const holder = yield* awaited(
    session.commit(
      (tx) =>
        tx.createTask(Dormant, null, {
          conversationId: conversation.id,
          ownership: { kind: "conversation" },
          abandonOnRestart: true,
        }),
      context,
    ),
  );
  const child = yield* awaited(
    session.commit(
      (tx) => tx.createTask(Dormant, null, { ownership: { kind: "task", taskId: holder } }),
      context,
    ),
  );
  const record = (yield* awaited(storage.task(holder, context)))!;
  const completing = {
    status: "completing",
    outcome: { status: "completed", result: null },
  } as const;
  yield* awaited(
    storage.commit(
      [{ type: "task", value: { ...record, state: completing } as typeof record }],
      context,
    ),
  );
  const { harness } = yield* openTasks(storage, [Dormant]);
  yield* Effect.gen(function* () {
    harness.resume();
    expect((yield* awaited(harness.waitForTask(child, context))).state.outcome.status).toBe(
      "aborted",
    );
    const settled = yield* awaited(harness.waitForTask(holder, context));
    expect(settled).toMatchObject({
      abortReason: "restart",
      state: { outcome: { status: "completed" } },
    });
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("work below a cancelled owner", () => {
  it("marks a flagged task that holds its outcome, aborting its owned work, and keeps the outcome", () =>
    Effect.runPromise(marksFlaggedTask));
});
