import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import sessionWatchesSupport from "./session-watches-support.ts";
import type sessionWatchesSupportTypes from "./session-watches-support.types.ts";

const { BACKGROUND_CONTEXT, createContextKey, withAbortSignal, withContextValue } = contextModule;

const { abortController, awaited } = effectSupport;
const { context, flush } = sessionSupport;
const { StateDoc, createState, deferred, writeState } = sessionWatchesSupport;

const neverFoldsFlightStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  const deliveries: Array<{ value: number; ops: unknown }> = [];
  watch.start((value, ops) =>
    runPromise(
      Effect.gen(function* () {
        deliveries.push({ ops, value: value?.value ?? -1 });
        if (deliveries.length === 1) {
          entered.resolve();
          yield* awaited(release.promise);
        }
      }),
    ),
  );
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* awaited(entered.promise);
  for (const value of Array.from({ length: 101 }, (_, i) => 2 + i)) {
    yield* writeState(session, (state) => {
      state.value = value;
    });
  }
  return { deliveries, release, watch };
});

const neverFoldsFlight = Effect.gen(function* () {
  const { watch, release, deliveries } = yield* neverFoldsFlightStep1;
  release.resolve();
  yield* flush;
  expect(deliveries[0]!.value).toBe(1);
  expect(deliveries[1]).toEqual({ ops: [["r", watch.value]], value: 102 });
  expect(deliveries).toHaveLength(2);
  yield* awaited(watch.stop());
});

const foldsRetirementOverflow = Effect.gen(function* () {
  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  for (const value of Array.from({ length: 100 }, (_, i) => 1 + i)) {
    yield* writeState(session, (state) => {
      state.value = value;
    });
  }
  yield* awaited(session.commit((tx) => tx.retireDoc(StateDoc), context));
  const deliveries: Array<{
    value: Readonly<sessionWatchesSupportTypes.State> | null;
    ops: unknown;
  }> = [];
  watch.start((value, ops) => {
    deliveries.push({ ops, value });

    return Promise.resolve();
  });
  expect(yield* awaited(watch.closed)).toEqual({ reason: "retired" });
  expect(deliveries).toEqual([{ ops: [["r", null]], value: null }]);
});

describe("Session document watches", () => {
  it("never folds the in-flight frame into an overflow reset", () =>
    Effect.runPromise(neverFoldsFlight));

  it("folds retirement into an overflow reset and then closes", () =>
    Effect.runPromise(foldsRetirementOverflow));
});

const deliversReplayableStructural = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const initial = watch.value;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const state = yield* awaited(tx.doc(StateDoc));
            const first = state.items.shift()!;
            state.items.unshift(first);
          }),
        ),
      context,
    ),
  );
  const newest = (yield* awaited(session.snapshot(StateDoc, context)))!;
  expect(newest).not.toBe(initial);
  expect(newest).toEqual(initial);
  const batches: unknown[] = [];
  watch.start((value, ops) => {
    expect(value).toBe(newest);
    batches.push(ops);

    return Promise.resolve();
  });
  yield* flush;
  expect(batches).toHaveLength(1);
  expect((batches[0] as readonly unknown[]).length).toBeGreaterThan(0);
  yield* awaited(watch.stop());
});

describe("Session document watches", () => {
  it("delivers replayable structural no-op commits instead of suppressing them", () =>
    Effect.runPromise(deliversReplayableStructural));
});

const preservesCommitContext = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const key = createContextKey<string>("watch-test");
  const parentController = abortController();
  const commitContext = withContextValue(
    key,
    "newest-commit",
    withAbortSignal(parentController.signal, BACKGROUND_CONTEXT),
  );
  const entered = deferred();
  const release = deferred();
  let deliveryContext: chordTypes.Context | undefined;
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
      commitContext,
    ),
  );
  yield* awaited(entered.promise);
  expect(deliveryContext!.value(key)).toBe("newest-commit");
  expect(deliveryContext!.abortSignal).toBeUndefined();
  parentController.abort("caller finished");
  const stopped = watch.stop();
  expect(yield* awaited(stopped)).toEqual({ reason: "stopped" });
  expect(deliveryContext!.abortSignal).toBeUndefined();
  release.resolve();
});

describe("Session document watches", () => {
  it("preserves commit Context values without inheriting producer cancellation", () =>
    Effect.runPromise(preservesCommitContext));
});
