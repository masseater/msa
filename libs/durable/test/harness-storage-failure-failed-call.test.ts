import { createModels } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type harnessStorageFailureFailedCallTestTypes from "./harness-storage-failure-failed-call.test.types.ts";
import harnessStorageFailureSupport from "./harness-storage-failure-support.ts";
import support from "./support.ts";

const { LiveDoc, defineExtension, defineTask } = durable;
const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { started } = harnessStorageFailureSupport;
const { ControlledStorage, abortController, awaited, context, deferred } = support;

const stubbornRunHarness = Effect.fn("stubbornRunHarness")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const release = deferred();
  const entered = deferred();
  const Stubborn = defineTask<null, { phase: "work" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "work" }),
    name: "test.stubborn",
    phases: {
      work: () =>
        runPromise(
          Effect.gen(function* () {
            entered.resolve();
            yield* awaited(release.promise);
          }),
        ),
    },
    version: 1,
  });
  const storage = new ControlledStorage();
  const registry = createRegistry();
  registry.install(defineExtension({ name: "tasks", tasks: [Stubborn] }));
  const reentry: { reentered?: Promise<unknown> } = {};
  const harness: harnessStorageFailureFailedCallTestTypes.Harness = yield* awaited(
    Harness.open(
      storage,
      {
        models: createModels(),
        onReport: () => {
          reentry.reentered ??= harness.waitForIdle(context);
        },
        registry,
      },
      context,
    ),
  );
  const root = yield* awaited(harness.root(context));
  return { Stubborn, entered, harness, reentry, release, root, storage };
});

const failsOnlyCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, reports } = yield* started(new MemoryStorage());
  const entry = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
  );
  const requests: (() => Promise<unknown>)[] = [
    () => root.entries({}, 10, { after: "x" }, context),
    () =>
      runPromise(
        Effect.gen(function* () {
          const page = yield* awaited(root.entries({ order: "ascending" }, 1, undefined, context));
          return yield* awaited(
            root.entries(
              { order: "descending" },
              1,
              page.next ?? { after: 1, order: "ascending" },
              context,
            ),
          );
        }),
      ),
    () => root.commit((tx) => tx.scanEntries({ conversationId: 999_999 as never }, 10), context),
    () => harness.snapshotAsOf(LiveDoc as never, root.id, entry.id, context),
  ];
  for (const request of requests) {
    yield* awaited(expect(request()).rejects.toMatchObject({ name: "StorageRequestError" }));
  }
  yield* awaited(
    expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined(),
  );
  let ended = false;
  void harness.closed.then(() => {
    ended = true;
    return undefined;
  });
  yield* Effect.sleep(1);
  expect(ended).toBe(false);
  expect(reports).toEqual([]);
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("fails only the call for an invalid request", () => Effect.runPromise(failsOnlyCall));
});

const failsThrowOwn = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness, root, reports } = yield* started(storage);
  const bug = new Error("listener bug");
  (harness as unknown as { observeCommits(listener: () => void): void }).observeCommits(() => {
    throw bug;
  });
  yield* awaited(
    expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined(),
  );
  expect(yield* awaited(harness.closed)).toEqual({ error: bug, reason: "failed" });
  expect(reports).toEqual([bug]);
  yield* awaited(harness.close(context));
});

const failsStorageError = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness, root, reports } = yield* started(storage);
  const held = storage.holdCommits();
  const failure = new Error("disk gone");
  storage.failNextCommit(failure);
  const committing = root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
  yield* awaited(held.entered);
  const closing = harness.close(context);
  held.release();
  yield* awaited(expect(committing).rejects.toBe(failure));
  yield* awaited(closing);
  expect(yield* awaited(harness.closed)).toEqual({ error: failure, reason: "failed" });
  expect(reports).toEqual([failure]);
});

describe("a failed Storage call", () => {
  it("fails it for a throw in its own commit listeners, which would leave memory behind storage", () =>
    Effect.runPromise(failsThrowOwn));

  it("fails it for a storage error during a host close, before the backend closes", () =>
    Effect.runPromise(failsStorageError));
});

const endsAbortJoins = Effect.gen(function* () {
  const { release, entered, Stubborn, storage, reentry, harness, root } =
    yield* stubbornRunHarness();
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Stubborn, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  yield* awaited(entered.promise);
  const held = storage.holdCommits();
  const aborting = harness.abortTask(id, context);
  yield* awaited(held.entered);
  held.release();
  const failure = new Error("disk gone");
  yield* Effect.sleep(5);
  storage.failNextCommit(failure);
  yield* awaited(
    expect(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context)).rejects.toBe(
      failure,
    ),
  );
  yield* awaited(expect(aborting).rejects.toMatchObject({ cause: failure, name: "SessionFailed" }));
  yield* awaited(
    expect(reentry.reentered).rejects.toMatchObject({
      cause: failure,
      name: "SessionFailed",
    }),
  );
  release.resolve();
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("ends an abort that joins a run ignoring its signal, and a reentrant report finds the Session failed", () =>
    Effect.runPromise(endsAbortJoins));
});

const doesNotFail = Effect.gen(function* () {
  const controller = abortController();
  const cancelled = new Error("caller gave up");
  class CancelledRead extends MemoryStorage {
    override scanEntries(
      ...args: Parameters<harnessStorageFailureFailedCallTestTypes.MemoryStorage["scanEntries"]>
    ) {
      if (args[3].abortSignal === controller.signal) {
        controller.abort(cancelled);
        return Promise.reject(cancelled);
      }
      return Promise.resolve(super.scanEntries(...args));
    }
  }
  const { harness, root } = yield* started(new CancelledRead());
  const cancelling: chordTypes.Context = { ...context, abortSignal: controller.signal };
  yield* awaited(expect(root.context(cancelling)).rejects.toBe(cancelled));
  yield* awaited(
    expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined(),
  );
  yield* awaited(harness.close(context));
});

describe("a failed Storage call", () => {
  it("does not fail it for a read its caller cancelled", () => Effect.runPromise(doesNotFail));
});

const reportsListenerOnReport = Effect.gen(function* () {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  yield* Effect.gen(function* () {
    const { harness, root, reports } = yield* started(new MemoryStorage());
    const asyncThrow = () => Promise.reject(new Error("async listener"));
    harness.subscribeCommits(asyncThrow);
    harness.subscribeClose(asyncThrow);
    yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
    yield* awaited(harness.close(context));
    yield* Effect.sleep(10);
    expect(reports.map(String)).toEqual(["Error: async listener", "Error: async listener"]);

    const registry = createRegistry();
    const rejecting = yield* awaited(
      Harness.open(
        new MemoryStorage(),
        { models: createModels(), onReport: asyncThrow, registry },
        context,
      ),
    );
    rejecting.subscribeCommits(() => {
      throw new Error("sync listener");
    });
    const again = yield* awaited(rejecting.root(context));
    yield* awaited(again.commit((tx) => tx.appendEntry(again.id, { kind: "note" }), context));
    yield* awaited(rejecting.close(context));
    yield* Effect.sleep(10);
    expect(unhandled).toEqual([]);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        process.off("unhandledRejection", onUnhandled);
      }),
    ),
  );
});

describe("listener and report errors", () => {
  it("reports a listener or onReport whose promise rejects, without an unhandled rejection", () =>
    Effect.runPromise(reportsListenerOnReport));
});
