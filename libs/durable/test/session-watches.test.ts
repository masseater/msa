import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";
import {
  StateDoc,
  createState,
  deferred,
  type State,
  writeState,
} from "./session-watches-support.ts";

const neverCreatesAbsent = Effect.gen(function* () {
  const { session, storage } = openTestSession();
  const commits = storage.commits.length;
  expect(yield* awaited(session.watchDoc(StateDoc, context))).toBeUndefined();
  expect(storage.commits).toHaveLength(commits);
  expect(storage.mintCount).toBe(0);
});

const keepsAcquisitionRevisionStep1 = Effect.gen(function* () {
  const { session, publications } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const initial = watch.value;
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* flush;
  const firstPublished = documentChanges(publications.at(-1)!)[0]!;
  yield* writeState(session, (state) => {
    state.value = 2;
  });
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
  return { watch, initial, firstPublished, secondPublished, deliveries };
});

const keepsAcquisitionRevision = Effect.gen(function* () {
  const { watch, initial, firstPublished, secondPublished, deliveries } =
    yield* keepsAcquisitionRevisionStep1;
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

const serializesCallbacksBuffersStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  const entered = deferred();
  const release = deferred();
  const values: number[] = [];
  return { runPromise, session, watch, entered, release, values };
});

const serializesCallbacksBuffers = Effect.gen(function* () {
  const { runPromise, session, watch, entered, release, values } =
    yield* serializesCallbacksBuffersStep1;
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
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* awaited(entered.promise);
  for (const value of Array.from({ length: 19 }, (_, i) => 2 + i)) {
    yield* writeState(session, (state) => {
      state.value = value;
    });
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
        const current = value?.value ?? -1;
        values.push(current);
        if (current === 1) {
          yield* writeState(session, (state) => {
            state.value = 2;
          });
        } else {
          completed.resolve();
        }
      }),
    ),
  );
  yield* writeState(session, (state) => {
    state.value = 1;
  });
  yield* awaited(completed.promise);
  expect(values).toEqual([1, 2]);
  yield* awaited(watch.stop());
});

const collapses101Pending = Effect.gen(function* () {
  const { session } = yield* createState();
  const watch = (yield* awaited(session.watchDoc(StateDoc, context)))!;
  for (const value of Array.from({ length: 101 }, (_, i) => 1 + i)) {
    yield* writeState(session, (state) => {
      state.value = value;
    });
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
