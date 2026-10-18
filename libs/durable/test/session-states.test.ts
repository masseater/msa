import { defineDoc, defineDocFamily } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

type State = { value: number; retained: { label: string } };

const StateDoc = defineDoc<State>({
  kind: "state.state",
  version: 1,
  scope: "session",
  initial: () => ({ value: 0, retained: { label: "stable" } }),
});

const FamilyDoc = defineDocFamily<{ value: number }, string>({
  kind: "state.family",
  version: 1,
  family: true,
  scope: "session",
  initial: (seed) => ({ value: seed.length }),
});

const createState = Effect.fn("createState")(function* () {
  const harness = openTestSession();
  yield* awaited(harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context));
  yield* flush;
  return harness;
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
  const deliveries: Array<{ value: Readonly<State> | null; sequence: number }> = [];
  state.subscribe((value, _context, delivery) =>
    deliveries.push({ value, sequence: delivery.sequence }),
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

const coldLoadsDefinition = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Copied = defineDoc<{ value: number }>({
    kind: "state.copied",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: 0 }),
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const entry = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const created = yield* awaited(tx.appendEntry(parentId, { kind: "point" }));
            (yield* awaited(tx.doc(Copied, parentId))).value = 7;
            return created;
          }),
        ),
      context,
    ),
  );
  const childId = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(
              tx.forkConversation(parentId, entry.id, { ownership: { kind: "ownerless" } }),
            )).id;
          }),
        ),
      context,
    ),
  );
  const reads = storage.documentReadCount;
  const state = (yield* awaited(session.documentState(Copied, childId, context)))!;
  expect(state.value).toEqual({ value: 7 });
  expect(storage.documentReadCount).toBeGreaterThan(reads);
  state.dispose();
});

describe("Session document states", () => {
  it("cold-loads a definition-free fork copy", () => Effect.runPromise(coldLoadsDefinition));
});

const hydratesMigratedTracker = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Old = defineDoc<{ value: number }>({
    kind: "state.migration",
    version: 1,
    scope: "session",
    initial: () => ({ value: 3 }),
  });
  const Current = defineDoc<{ value: number; migrated: boolean }>({
    kind: "state.migration",
    version: 2,
    scope: "session",
    initial: () => ({ value: 0, migrated: false }),
    migrate: (value) => ({ value: value["value"] as number, migrated: true }),
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Old).then(() => undefined), context));
  yield* awaited(session.unloadDocuments());
  const commits = storage.commits.length;
  const state = (yield* awaited(session.documentState(Current, context)))!;
  expect(state.value).toEqual({ value: 3, migrated: true });
  expect(storage.commits).toHaveLength(commits);
  const baseline = state.value;

  yield* awaited(session.commit((tx) => tx.doc(Current).then(() => undefined), context));
  yield* flush;
  expect(storage.commits).toHaveLength(commits + 1);
  expect(state.value).toBe(baseline);
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
  expect(state.value).toEqual({ value: 4, migrated: true });
  state.dispose();
});

describe("Session document states", () => {
  it("hydrates a migrated tracker without writing and skips an equal version-base update", () =>
    Effect.runPromise(hydratesMigratedTracker));
});

const continuesExactCommitted = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = yield* createState();
  const state = (yield* awaited(session.documentState(StateDoc, context)))!;
  const baseline = state.value;
  const reads = storage.documentReadCount;
  yield* awaited(session.unloadDocuments());
  const reloaded = yield* awaited(session.snapshot(StateDoc, context));
  expect(reloaded).toEqual(baseline);
  expect(reloaded).not.toBe(baseline);
  expect(storage.documentReadCount).toBeGreaterThan(reads);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StateDoc))).value = 6;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(state.value?.value).toBe(6);
  state.dispose();
});

const exposesTrustedShared = Effect.gen(function* () {
  const { session } = yield* createState();
  const snapshot = (yield* awaited(session.snapshot(StateDoc, context)))!;
  const state = (yield* awaited(session.documentState(StateDoc, context)))!;
  expect(state.value).toBe(snapshot);
  expect(Object.isFrozen(state.value)).toBe(false);
  expect(Object.isFrozen(state.value!.retained)).toBe(false);
  state.dispose();
});

describe("Session document states", () => {
  it("continues from exact committed values after the tracker cache unloads", () =>
    Effect.runPromise(continuesExactCommitted));

  it("exposes trusted shared immutable values without freezing", () =>
    Effect.runPromise(exposesTrustedShared));
});
