import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ControlledStorage from "./controlled-storage.ts";
import effectSupport from "./effect-support.ts";
import harnessStorageFailureSupport from "./harness-storage-failure-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { LiveDoc, defineTask } = durable;
const { watchEvents } = harnessModule;

const { awaited } = effectSupport;
const { FailingCalls, Waiting, running, signals, started } = harnessStorageFailureSupport;
const { context } = sessionSupport;
const { deferred, openTasks } = taskSupport;

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

  const failed = { cause: failure, name: "SessionFailed" };
  yield* awaited(expect(task).rejects.toMatchObject(failed));
  yield* awaited(expect(idle).rejects.toMatchObject(failed));
  expect(yield* awaited(watch.closed)).toEqual({ error: failure, reason: "session_failed" });
  expect(yield* awaited(stream.closed)).toEqual({ error: failure, reason: "session_failed" });
  yield* awaited(expect(harness.getTask(id, context)).rejects.toMatchObject(failed));
  yield* awaited(expect(harness.waitForIdle(context)).rejects.toMatchObject(failed));
  yield* awaited(
    expect(root.submit({ content: "x", type: "input" }, context)).rejects.toMatchObject(failed),
  );
  expect(yield* awaited(harness.closed)).toEqual({ error: failure, reason: "failed" });
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
  expect(yield* awaited(harness.closed)).toEqual({ error: storage.error, reason: "failed" });
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
    return undefined;
  });
  for (const _ of Array.from({ length: 5 })) yield* Effect.sleep(1);
  expect(closed).toBe(false);
  release.resolve();
  yield* awaited(
    expect(reading).rejects.toMatchObject({ cause: storage.error, name: "SessionFailed" }),
  );
  expect(yield* awaited(harness.closed)).toEqual({ error: storage.error, reason: "failed" });
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
    override close(closeContext: chordTypes.Context): Promise<void> {
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
    error: closeError,
    reason: "failed",
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
  expect(yield* awaited(failed.harness.closed)).toEqual({ error: failure, reason: "failed" });
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
  const failed = { cause: failure, name: "SessionFailed" };
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

const endsWhatTaskStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const ends: unknown[] = [];
  const watching = deferred();
  const Watcher = defineTask<null, { phase: "work" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "work" }),
    name: "test.watcher",
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
    version: 1,
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
  return { ends, failure, opened, root };
});

const endsWhatTask = Effect.gen(function* () {
  const { ends, opened, root, failure } = yield* endsWhatTaskStep1;
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      failure,
    ),
  );
  yield* awaited(opened.harness.closed);
  expect(ends).toEqual([{ error: failure, reason: "session_failed" }, "SessionFailed"]);
  yield* awaited(opened.harness.close(context));
});

describe("a failed Storage call", () => {
  it("ends what a task holds with session_failed, not as cancelled by its signal", () =>
    Effect.runPromise(endsWhatTask));
});
