import type { Context } from "@msa/chord";
import { withCancel } from "@msa/chord/context";
import { applyImmutable } from "@msa/chord/delta";
import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, flush, openTestSession } from "./session-support.ts";
import { deferred, createState, StateDoc, type State } from "./session-watches-support.ts";

const keepsEarlierImmutable = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const initial = watch.value;
  let delivered: Readonly<State> | null | undefined;
  watch.start((value) => {
    delivered = value;

    return Promise.resolve();
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 1;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(delivered).toBe(watch.value);
  expect(delivered).not.toBe(initial);
  expect(delivered?.retained).toBe(initial?.retained);
  expect(initial?.value).toBe(0);
  yield* awaited(watch.stop());
});

const deliversRetirementDoes = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const oldWatch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const values: Array<Readonly<State> | null> = [];
  oldWatch.start((value) => {
    values.push(value);

    return Promise.resolve();
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.retireDoc(StateDoc));
            (yield* awaited(tx.doc(StateDoc))).value = 10;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(oldWatch.closed)).toEqual({ reason: "retired" });
  expect(values).toEqual([null]);
  expect(oldWatch.value).toBeNull();

  const replacement = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  expect(replacement.value?.value).toBe(10);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 11;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(oldWatch.value).toBeNull();
  yield* awaited(replacement.stop());
});

describe("Session document watches", () => {
  it("keeps earlier immutable revisions stable", () => Effect.runPromise(keepsEarlierImmutable));

  it("delivers retirement and does not follow recreation", () =>
    Effect.runPromise(deliversRetirementDoes));
});

const sessionCloseDiscards = Effect.gen(function* () {
  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const baseline = watch.value;
  yield* awaited(session.commit((tx) => tx.retireDoc(StateDoc), context));
  yield* awaited(session.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  expect(watch.value).toBe(baseline);
  expect(() => watch.start(() => Promise.resolve(undefined))).toThrow("stopped");
});

const sessionCloseDiscardsRetirement = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  const values: Array<number | null> = [];
  watch.start((value) =>
    runPromise(
      Effect.gen(function* () {
        values.push(value?.value ?? null);
        entered.resolve();
        yield* awaited(release.promise);
      }),
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 1;
          }),
        ),
      context,
    ),
  );
  yield* awaited(entered.promise);
  yield* awaited(session.commit((tx) => tx.retireDoc(StateDoc), context));
  yield* awaited(session.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  release.resolve();
  yield* flush;
  expect(values).toEqual([1]);
});

const supportsIdempotentStop = Effect.gen(function* () {
  const { session } = yield* createState();
  const started = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  started.start(() => Promise.resolve(undefined));
  expect(() => started.start(() => Promise.resolve(undefined))).toThrow("already started");
  const first = started.stop();
  const second = started.stop();
  expect(second).toBe(first);
  expect(yield* awaited(first)).toEqual({ reason: "stopped" });

  const stopped = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  yield* awaited(stopped.stop());
  expect(() => stopped.start(() => Promise.resolve(undefined))).toThrow("stopped");
});

describe("Session document watches", () => {
  it("Session close discards retirement buffered before start", () =>
    Effect.runPromise(sessionCloseDiscards));

  it("Session close discards retirement behind an in-flight callback", () =>
    Effect.runPromise(sessionCloseDiscardsRetirement));

  it("supports idempotent stop and rejects repeated or late start", () =>
    Effect.runPromise(supportsIdempotentStop));
});

const cancelsAcquisitionWithout = Effect.gen(function* () {
  const { session, storage } = yield* createState();
  yield* awaited(session.unloadDocuments());
  const gate = storage.holdFindDocument();
  const child = withCancel(context);
  const acquisition = session.watchDoc(StateDoc, child.context);
  yield* awaited(gate.entered);
  child.cancel(new Error("cancel acquisition"));
  gate.release();
  yield* awaited(expect(acquisition).rejects.toThrow("cancel acquisition"));
  yield* awaited(session.close(context));
});

const cancelsFutureDelivery = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const child = withCancel(context);
  const watch = (yield* awaited(session.watchDoc(StateDoc, child.context)))!;
  const entered = deferred();
  const release = deferred();
  let deliveryContext: Context | undefined;
  watch.start((_value, _ops, delivered) =>
    runPromise(
      Effect.gen(function* () {
        deliveryContext = delivered;
        entered.resolve();
        yield* awaited(release.promise);
      }),
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 1;
          }),
        ),
      context,
    ),
  );
  yield* awaited(entered.promise);
  child.cancel();
  expect(yield* awaited(watch.closed)).toEqual({ reason: "cancelled" });
  expect(deliveryContext!.abortSignal).toBeUndefined();
  release.resolve();
});

describe("Session document watches", () => {
  it("cancels acquisition without leaking a registered watch", () =>
    Effect.runPromise(cancelsAcquisitionWithout));

  it("cancels future delivery without aborting an in-flight callback", () =>
    Effect.runPromise(cancelsFutureDelivery));
});

const sessionCloseStops = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  let deliveryContext: Context | undefined;
  watch.start((_value, _ops, delivered) =>
    runPromise(
      Effect.gen(function* () {
        deliveryContext = delivered;
        entered.resolve();
        yield* awaited(release.promise);
      }),
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 1;
          }),
        ),
      context,
    ),
  );
  yield* awaited(entered.promise);
  yield* awaited(session.close(context));
  expect(deliveryContext!.abortSignal).toBeUndefined();
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  release.resolve();
});

const settlesListenerFailure = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const failed = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const healthy = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  failed.start(() => {
    return Promise.reject(new Error("listener failed"));
  });
  let healthyCalls = 0;
  healthy.start(() => {
    healthyCalls++;

    return Promise.resolve();
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 1;
          }),
        ),
      context,
    ),
  );
  const end = yield* awaited(failed.closed);
  expect(end.reason).toBe("listener_error");
  if (end.reason === "listener_error") expect(end.error.message).toBe("listener failed");
  yield* flush;
  expect(healthyCalls).toBe(1);
  yield* awaited(healthy.stop());
});

describe("Session document watches", () => {
  it("Session close stops future delivery without joining an in-flight callback", () =>
    Effect.runPromise(sessionCloseStops));

  it("settles listener failure on only the affected watch", () =>
    Effect.runPromise(settlesListenerFailure));
});

const hydratesMigrationWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Old = defineDoc<{ value: number }>({
    kind: "watch.migration",
    version: 1,
    scope: "session",
    initial: () => ({ value: 3 }),
  });
  const Current = defineDoc<{ value: number; migrated: boolean }>({
    kind: "watch.migration",
    version: 2,
    scope: "session",
    initial: () => ({ value: 0, migrated: false }),
    migrate: (value) => ({ value: value["value"] as number, migrated: true }),
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Old).then(() => undefined), context));
  yield* awaited(session.unloadDocuments());
  const commits = storage.commits.length;
  const watch = (yield* awaited(session.watchDoc(Current, context)))!;
  expect(watch.value).toEqual({ value: 3, migrated: true });
  expect(storage.commits).toHaveLength(commits);
  const values: number[] = [];
  watch.start((value) => {
    values.push(value?.value ?? -1);

    return Promise.resolve();
  });
  yield* awaited(session.commit((tx) => tx.doc(Current).then(() => undefined), context));
  yield* flush;
  expect(values).toEqual([]);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Current))).value = 4;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(values).toEqual([4]);
  yield* awaited(watch.stop());
});

describe("Session document watches", () => {
  it("hydrates migration without writing and observes the later exact edit", () =>
    Effect.runPromise(hydratesMigrationWithout));
});

const canReplayEvery = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  let replica: Readonly<State> | null = watch.value;
  watch.start((value, ops) => {
    replica = applyImmutable(replica, ops);
    expect(replica).toEqual(value);

    return Promise.resolve();
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const state = yield* awaited(tx.doc(StateDoc));
            state.value = 3;
            state.items.splice(0, 1);
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(replica).toEqual(watch.value);
  yield* awaited(watch.stop());
});

const continuesTrackerCache = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const baseline = watch.value;
  const reads = storage.documentReadCount;
  yield* awaited(session.unloadDocuments());
  const reloaded = yield* awaited(session.snapshot(StateDoc, context));
  expect(reloaded).toEqual(baseline);
  expect(reloaded).not.toBe(baseline);
  expect(storage.documentReadCount).toBeGreaterThan(reads);
  watch.start(() => Promise.resolve(undefined));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 7;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(watch.value?.value).toBe(7);
  yield* awaited(watch.stop());
});

describe("Session document watches", () => {
  it("can replay every delivered exact operation batch from the acquisition revision", () =>
    Effect.runPromise(canReplayEvery));

  it("continues after the tracker cache unloads", () => Effect.runPromise(continuesTrackerCache));
});
