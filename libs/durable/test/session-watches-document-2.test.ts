import type { Context } from "@msa/chord";
import { applyImmutable } from "@msa/chord/delta";
import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, flush, openTestSession } from "./session-support.ts";
import { deferred, createState, StateDoc, type State } from "./session-watches-support.ts";

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
  failed.start(() => Promise.reject(new Error("listener failed")));
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
