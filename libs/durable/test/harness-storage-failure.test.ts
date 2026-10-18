import type { Context } from "@msa/chord";
import { defineTask, LiveDoc, StorageRequestError, type TaskId } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  FailingCalls,
  running,
  signals,
  Waiting,
  started,
} from "./harness-storage-failure-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred, openTasks } from "./task-support.ts";

const endsEverythingFirst = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness, root, reports } = yield* started(storage);
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Waiting, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  yield* running(harness, id);
  const task = harness.waitForTask(id, context);
  const idle = harness.waitForIdle(context);
  const watch = (yield* awaited(harness.watchDoc(LiveDoc, root.id, context)))!;
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  stream.start(() => Promise.resolve());

  const failure = new Error("disk gone");
  storage.failNextCommit(failure);
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      failure,
    ),
  );

  const failed = { name: "SessionFailed", cause: failure };
  yield* awaited(expect(task).rejects.toMatchObject(failed));
  yield* awaited(expect(idle).rejects.toMatchObject(failed));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_failed", error: failure });
  expect(yield* awaited(stream.closed)).toEqual({ reason: "session_failed", error: failure });
  yield* awaited(expect(harness.getTask(id, context)).rejects.toMatchObject(failed));
  yield* awaited(expect(harness.waitForIdle(context)).rejects.toMatchObject(failed));
  yield* awaited(
    expect(root.submit({ type: "input", content: "x" }, context)).rejects.toMatchObject(failed),
  );
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: failure });
  expect(signals).toEqual(["aborted"]);
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("ends everything with the first error: the call, later calls, waits, watches, streams, running tasks", () =>
    Effect.runPromise(endsEverythingFirst));
});

const failsReadOff = Effect.gen(function* () {
  const storage = new FailingCalls();
  const { harness, root, reports } = yield* started(storage);
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  storage.failing.add("scanRange");
  yield* awaited(expect(root.context(context)).rejects.toBe(storage.error));
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: storage.error });
  expect(reports).toEqual([storage.error]);
  yield* awaited(harness.close(context));
});

const endsStorageCalls = Effect.gen(function* () {
  const storage = new FailingCalls();
  const { harness, root } = yield* started(storage);
  const release = deferred();
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  storage.heldRange = { entered: deferred(), release: release.promise };
  const reading = root.context(context);
  yield* awaited(storage.heldRange.entered.promise);
  storage.failing.add("mintId");
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      storage.error,
    ),
  );
  let closed = false;
  void harness.closed.then(() => {
    closed = true;
  });
  for (const _ of Array.from({ length: 5 })) yield* Effect.sleep(1);
  expect(closed).toBe(false);
  release.resolve();
  yield* awaited(
    expect(reading).rejects.toMatchObject({ name: "SessionFailed", cause: storage.error }),
  );
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: storage.error });
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("fails it from a read off the Session line, as a context read makes", () =>
    Effect.runPromise(failsReadOff));

  it("ends Storage calls underway with SessionFailed, and closes once they have settled", () =>
    Effect.runPromise(endsStorageCalls));
});

const failsStorageCannot = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const closeError = new Error("close failed");
  class FailingClose extends ControlledStorage {
    override close(closeContext: Context): Promise<void> {
      const superClose = super.close.bind(this);
      return runPromise(
        Effect.gen(function* () {
          yield* awaited(superClose(closeContext));
          throw closeError;
        }),
      );
    }
  }
  const healthy = yield* started(new FailingClose());
  yield* awaited(expect(healthy.harness.close(context)).rejects.toBe(closeError));
  expect(yield* awaited(healthy.harness.closed)).toEqual({
    reason: "failed",
    error: closeError,
  });
  expect(healthy.reports).toEqual([closeError]);

  const storage = new FailingClose();
  const failed = yield* started(storage);
  const failure = new Error("disk gone");
  storage.failNextCommit(failure);
  yield* awaited(
    expect(
      failed.root.commit((tx) => tx.appendEntry(failed.root.id, { kind: "note" }), context),
    ).rejects.toBe(failure),
  );
  expect(yield* awaited(failed.harness.closed)).toEqual({ reason: "failed", error: failure });
  expect(failed.reports).toEqual([failure]);
});

const rejectsHarnessOwn = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness, root } = yield* started(storage);
  const failure = new Error("disk gone");
  storage.failNextCommit(failure);
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      failure,
    ),
  );
  const failed = { name: "SessionFailed", cause: failure };
  expect(() => harness.resume()).toThrow(expect.objectContaining(failed));
  yield* awaited(expect(harness.root(context)).rejects.toMatchObject(failed));
  yield* awaited(expect(harness.conversation(root.id, context)).rejects.toMatchObject(failed));
  yield* awaited(
    expect(
      harness.createConversation({ ownership: { kind: "ownerless" } }, context),
    ).rejects.toMatchObject(failed),
  );
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("fails it when Storage cannot close; an earlier failure stays the cause", () =>
    Effect.runPromise(failsStorageCannot));

  it("rejects the Harness's own calls with SessionFailed after a failure", () =>
    Effect.runPromise(rejectsHarnessOwn));
});

const endsWhatTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const ends: unknown[] = [];
  const watching = deferred();
  const Watcher = defineTask<null, { phase: "work" }, null>({
    name: "test.watcher",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime, phaseContext) =>
        runPromise(
          Effect.gen(function* () {
            const doc = (yield* awaited(
              runtime.watchDoc(LiveDoc, runtime.conversationId, phaseContext),
            ))!;
            const handle = (yield* awaited(
              runtime.conversation(runtime.conversationId, phaseContext),
            ))!;
            const idle = handle.waitForIdle(phaseContext).then(
              () => "resolved",
              (error: Error) => error.name,
            );
            watching.resolve();
            ends.push(yield* awaited(doc.closed), yield* awaited(idle));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  const storage = new ControlledStorage();
  const opened = yield* openTasks(storage, [Watcher]);
  const root = yield* awaited(opened.harness.root(context));
  yield* awaited(
    root.commit(
      (tx) => tx.createTask(Watcher, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  opened.harness.resume();
  yield* awaited(watching.promise);
  const failure = new Error("disk gone");
  storage.failNextCommit(failure);
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      failure,
    ),
  );
  yield* awaited(opened.harness.closed);
  expect(ends).toEqual([{ reason: "session_failed", error: failure }, "SessionFailed"]);
  yield* awaited(opened.harness.close(context));
});

describe("a failed Storage call", () => {
  it("ends what a task holds with session_failed, not as cancelled by its signal", () =>
    Effect.runPromise(endsWhatTask));
});

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
