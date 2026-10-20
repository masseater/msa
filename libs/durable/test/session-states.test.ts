import { defineDocFamily } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionStatesCases from "./session-states-cases.ts";
import type sessionStatesCasesTypes from "./session-states-cases.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { StateDoc, createState } = sessionStatesCases;
const { context, documentChanges, flush, openTestSession } = sessionSupport;

const FamilyDoc = defineDocFamily<{ value: number }, string>({
  family: true,
  initial: (seed) => ({ value: seed.length }),
  kind: "state.family",
  scope: "session",
  version: 1,
});

const neverCreatesAbsent = Effect.gen(function* () {
  const { session, storage } = openTestSession();
  const commits = storage.commits.length;
  expect(yield* awaited(session.documentState(StateDoc, context))).toBeUndefined();
  expect(yield* awaited(session.documentState(FamilyDoc, "missing", context))).toBeUndefined();
  expect(storage.commits).toHaveLength(commits);
  expect(storage.mintCount).toBe(0);
});

const returnsImmediatelyHydrated = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const baseline = (yield* awaited(session.snapshot(StateDoc, context)))!;
  const state = (yield* awaited(session.documentState(StateDoc, context)))!;
  const deliveries: Array<{
    value: Readonly<sessionStatesCasesTypes.State> | null;
    sequence: number;
  }> = [];
  state.subscribe((value, _context, delivery) =>
    deliveries.push({ sequence: delivery.sequence, value }),
  );
  expect(state.value).toBe(baseline);

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

  expect(deliveries.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
  expect(deliveries.map(({ value }) => value?.value)).toEqual([0, 1, 2]);
  expect(state.value).toBe(yield* awaited(session.snapshot(StateDoc, context)));
  state.dispose();
});

describe("Session document states", () => {
  it("never creates an absent document", () => Effect.runPromise(neverCreatesAbsent));

  it("returns an immediately hydrated read-only state with contiguous Chord deliveries", () =>
    Effect.runPromise(returnsImmediatelyHydrated));
});

const createsIndependentDisposable = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const first = (yield* awaited(session.documentState(StateDoc, context)))!;
  const second = (yield* awaited(session.documentState(StateDoc, context)))!;
  expect(second).not.toBe(first);
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
  expect(first.value?.value).toBe(1);
  expect(second.value?.value).toBe(1);

  first.dispose();
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
  expect(first.value?.value).toBe(1);
  expect(second.value?.value).toBe(2);
  second.dispose();
});

const sharesExactCommitted = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, publications } = yield* createState();
  const state = (yield* awaited(session.documentState(StateDoc, context)))!;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 4;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const published = documentChanges(publications.at(-1)!)[0]!;
  expect(state.value).toBe(published.value);
  expect(state.value?.retained).toBe(
    (yield* awaited(session.snapshot(StateDoc, context)))!.retained,
  );
  state.dispose();
});

const capturesLateBaseline = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
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
  const state = (yield* awaited(session.documentState(StateDoc, context)))!;
  const deliveries: number[] = [];
  state.subscribe((_value, _context, delivery) => deliveries.push(delivery.sequence));
  yield* flush;
  expect(state.value?.value).toBe(1);
  expect(deliveries).toEqual([0]);
  state.dispose();
});

describe("Session document states", () => {
  it("creates independent disposable states for one incarnation", () =>
    Effect.runPromise(createsIndependentDisposable));

  it("shares exact committed value references with Chord", () =>
    Effect.runPromise(sharesExactCommitted));

  it("captures a late baseline without redelivering an already covered commit", () =>
    Effect.runPromise(capturesLateBaseline));
});

const publishesNullRetirement = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = yield* createState();
  const oldState = (yield* awaited(session.documentState(StateDoc, context)))!;
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
  yield* flush;
  expect(oldState.value).toBeNull();

  const replacement = (yield* awaited(session.documentState(StateDoc, context)))!;
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
  expect(oldState.value).toBeNull();
  expect(replacement.value?.value).toBe(11);
  oldState.dispose();
  replacement.dispose();
});

describe("Session document states", () => {
  it("publishes null retirement and never follows a replacement incarnation", () =>
    Effect.runPromise(publishesNullRetirement));
});
