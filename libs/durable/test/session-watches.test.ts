import type { Context } from "@msa/chord";
import {
  BACKGROUND_CONTEXT,
  createContextKey,
  withAbortSignal,
  withContextValue,
} from "@msa/chord/context";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { abortController, awaited } from "./effect-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";
import { deferred, createState, StateDoc, type State } from "./session-watches-support.ts";

const neverCreatesAbsent = Effect.gen(function* () {
  const { session, storage } = openTestSession();
  const commits = storage.commits.length;
  expect(yield* awaited(session.watchDoc(StateDoc, context))).toBeUndefined();
  expect(storage.commits).toHaveLength(commits);
  expect(storage.mintCount).toBe(0);
});

const keepsAcquisitionRevision = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, publications } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const initial = watch.value;
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
  const firstPublished = documentChanges(publications.at(-1)!)[0]!;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 2;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const secondPublished = documentChanges(publications.at(-1)!)[0]!;
  expect(watch.value).toBe(initial);

  let inline = true;
  const deliveries: Array<{ value: Readonly<State> | null; ops: unknown }> = [];
  watch.start((value, ops) => {
    expect(inline).toBe(false);
    expect(watch.value).toBe(value);
    deliveries.push({ value, ops });

    return Promise.resolve();
  });
  inline = false;
  expect(deliveries).toHaveLength(0);
  yield* flush;
  expect(deliveries.map(({ value }) => value?.value)).toEqual([1, 2]);
  expect(deliveries[0]!.value).toBe(firstPublished.value);
  expect(deliveries[0]!.ops).toBe(firstPublished.ops);
  expect(deliveries[1]!.value).toBe(secondPublished.value);
  expect(deliveries[1]!.ops).toBe(secondPublished.ops);
  expect(initial?.value).toBe(0);
  yield* awaited(watch.stop());
});

describe("Session document watches", () => {
  it("never creates an absent document", () => Effect.runPromise(neverCreatesAbsent));

  it("keeps the acquisition revision until start and delivers exact committed frames", () =>
    Effect.runPromise(keepsAcquisitionRevision));
});

const serializesCallbacksBuffers = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  const values: number[] = [];
  let active = 0;
  let maxActive = 0;
  watch.start((value) =>
    runPromise(
      Effect.gen(function* () {
        active++;
        maxActive = Math.max(maxActive, active);
        values.push(value?.value ?? -1);
        if (values.length === 1) {
          entered.resolve();
          yield* awaited(release.promise);
        }
        active--;
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
  for (const value of Array.from({ length: 19 }, (_, i) => 2 + i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(StateDoc))).value = value;
            }),
          ),
        context,
      ),
    );
  }
  expect(values).toEqual([1]);
  release.resolve();
  yield* flush;
  expect(maxActive).toBe(1);
  expect(values).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  yield* awaited(watch.stop());
});

describe("Session document watches", () => {
  it("serializes callbacks and buffers exact frames committed while one is in flight", () =>
    Effect.runPromise(serializesCallbacksBuffers));
});

const allowsListenerInitiate = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const completed = deferred();
  const values: number[] = [];
  watch.start((value) =>
    runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const current = value?.value ?? -1;
        values.push(current);
        if (current === 1) {
          yield* awaited(
            session.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    (yield* awaited(tx.doc(StateDoc))).value = 2;
                  }),
                ),
              context,
            ),
          );
        } else {
          completed.resolve();
        }
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
  yield* awaited(completed.promise);
  expect(values).toEqual([1, 2]);
  yield* awaited(watch.stop());
});

const collapses101Pending = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  for (const value of Array.from({ length: 101 }, (_, i) => 1 + i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(StateDoc))).value = value;
            }),
          ),
        context,
      ),
    );
  }
  const deliveries: Array<{ value: number; ops: unknown }> = [];
  watch.start((value, ops) => {
    deliveries.push({ value: value?.value ?? -1, ops });

    return Promise.resolve();
  });
  yield* flush;
  expect(deliveries).toEqual([{ value: 101, ops: [["r", watch.value]] }]);
  yield* awaited(watch.stop());
});

describe("Session document watches", () => {
  it("allows a listener to initiate a later Session commit", () =>
    Effect.runPromise(allowsListenerInitiate));

  it("collapses 101 pending commits to one root replacement", () =>
    Effect.runPromise(collapses101Pending));
});

const neverFoldsFlight = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  const deliveries: Array<{ value: number; ops: unknown }> = [];
  watch.start((value, ops) =>
    runPromise(
      Effect.gen(function* () {
        deliveries.push({ value: value?.value ?? -1, ops });
        if (deliveries.length === 1) {
          entered.resolve();
          yield* awaited(release.promise);
        }
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
  for (const value of Array.from({ length: 101 }, (_, i) => 2 + i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(StateDoc))).value = value;
            }),
          ),
        context,
      ),
    );
  }
  release.resolve();
  yield* flush;
  expect(deliveries[0]!.value).toBe(1);
  expect(deliveries[1]).toEqual({ value: 102, ops: [["r", watch.value]] });
  expect(deliveries).toHaveLength(2);
  yield* awaited(watch.stop());
});

const foldsRetirementOverflow = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  for (const value of Array.from({ length: 100 }, (_, i) => 1 + i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(StateDoc))).value = value;
            }),
          ),
        context,
      ),
    );
  }
  yield* awaited(session.commit((tx) => tx.retireDoc(StateDoc), context));
  const deliveries: Array<{ value: Readonly<State> | null; ops: unknown }> = [];
  watch.start((value, ops) => {
    deliveries.push({ value, ops });

    return Promise.resolve();
  });
  expect(yield* awaited(watch.closed)).toEqual({ reason: "retired" });
  expect(deliveries).toEqual([{ value: null, ops: [["r", null]] }]);
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
