import { StorageRequestError, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { FailingCalls, started } from "./harness-storage-failure-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

const failsFailedId = Effect.gen(function* () {
  const storage = new FailingCalls();
  const { harness, root } = yield* started(storage);
  storage.failing.add("mintId");
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      storage.error,
    ),
  );
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: storage.error });
  yield* awaited(harness.close(context));
});

const doesNotCommit = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new FailingCalls();
  const { harness, root } = yield* started(storage);
  const written = storage.admittedCommits.length;
  storage.failing.add("task");
  yield* awaited(
    expect(
      root.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              yield* awaited(tx.task(1 as TaskId).catch(() => {}));
              yield* awaited(tx.appendEntry(root.id, { kind: "note" }));
            }),
          ),
        context,
      ),
    ).rejects.toMatchObject({ name: "SessionFailed", cause: storage.error }),
  );
  expect(storage.admittedCommits.length).toBe(written);
  yield* awaited(harness.close(context));
});

const failsStorageRequestErrorCommit = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness, root } = yield* started(storage);
  const rejection = new StorageRequestError("bad batch");
  storage.failNextCommit(rejection);
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      rejection,
    ),
  );
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: rejection });
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("fails it from a failed ID mint", () => Effect.runPromise(failsFailedId));

  it("does not commit what a callback did after it caught a failed read", () =>
    Effect.runPromise(doesNotCommit));

  it("fails it for a StorageRequestError from a commit, whose effect is unknown", () =>
    Effect.runPromise(failsStorageRequestErrorCommit));
});
