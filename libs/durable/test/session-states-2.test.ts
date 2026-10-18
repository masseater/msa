import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { StateDoc, createState } from "./session-states-cases.ts";
import { context, createConversation, flush, openTestSession } from "./session-support.ts";

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
