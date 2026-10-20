import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const { context, createConversation, openTestSession } = sessionSupport;

function ancestorDocs() {
  const AsOf = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "initial" }),
    kind: "fork.ancestry.as-of",
    scope: "conversation",
    version: 1,
  });
  const Current = defineDoc<{ value: string }>({
    fork: "current",
    history: "latest",
    initial: () => ({ value: "initial" }),
    kind: "fork.ancestry.current",
    scope: "conversation",
    version: 1,
  });
  return { AsOf, Current };
}

function storedVersionDocs() {
  const V1 = defineDoc<{ count: number }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ count: 1 }),
    kind: "fork.stored-version",
    scope: "conversation",
    version: 1,
  });
  const fork: { migrations: number; forkAt?: durableTypes.EntryId } = { migrations: 0 };
  const V3 = defineDoc<{ count: number; migrated: boolean }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ count: 0, migrated: false }),
    kind: "fork.stored-version",
    migrate: (value, fromVersion) => {
      expect(fromVersion).toBe(1);
      fork.migrations++;
      return { count: value["count"] as number, migrated: true };
    },
    scope: "conversation",
    version: 3,
  });
  const { session, storage } = openTestSession();
  return { V1, V3, fork, session, storage };
}

const selectsEntryOwningStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { AsOf, Current } = ancestorDocs();
  const { session } = openTestSession();
  const rootId = yield* awaited(createConversation(session));
  const inherited = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const inheritedInner = (yield* awaited(tx.appendEntry(rootId, { kind: "root" }))).id;
            (yield* awaited(tx.doc(AsOf, rootId))).value = "root-at-entry";
            (yield* awaited(tx.doc(Current, rootId))).value = "root-current";
            return inheritedInner;
          }),
        ),
      context,
    ),
  );
  const parent = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(rootId, inherited, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  const parentEntry = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const parentEntryInner = (yield* awaited(tx.appendEntry(parent.id, { kind: "parent" })))
              .id;
            (yield* awaited(tx.doc(AsOf, parent.id))).value = "parent-at-own-entry";
            (yield* awaited(tx.doc(Current, parent.id))).value = "parent-current";
            return parentEntryInner;
          }),
        ),
      context,
    ),
  );
  return { AsOf, Current, inherited, parent, parentEntry, session };
});

const selectsEntryOwning = Effect.gen(function* () {
  const { AsOf, Current, session, inherited, parent, parentEntry } = yield* selectsEntryOwningStep1;
  const inheritedFork = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parent.id, inherited, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(AsOf, inheritedFork.id, context))).toEqual({
    value: "root-at-entry",
  });
  expect(yield* awaited(session.snapshot(Current, inheritedFork.id, context))).toEqual({
    value: "parent-current",
  });

  const ownEntryFork = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parent.id, parentEntry, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(AsOf, ownEntryFork.id, context))).toEqual({
    value: "parent-at-own-entry",
  });
  expect(yield* awaited(session.snapshot(Current, ownEntryFork.id, context))).toEqual({
    value: "parent-current",
  });
});

describe("Session conversation document forks", () => {
  it("selects the entry-owning ancestor for as-of copies and the immediate parent for current copies", () =>
    Effect.runPromise(selectsEntryOwning));
});

const copiesStoredValue = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { V1, fork, V3, session, storage } = storedVersionDocs();
  const parentId = yield* awaited(createConversation(session));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            fork.forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(V1, parentId));
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.unloadDocuments());
  expect(yield* awaited(session.snapshot(V3, parentId, context))).toEqual({
    count: 1,
    migrated: true,
  });
  expect(fork.migrations).toBe(1);

  const child = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, fork.forkAt!, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  expect(fork.migrations).toBe(1);
  const childRecord = yield* awaited(
    storage.findDocument(
      { kind: V1.definition.kind, scope: { conversationId: child.id, kind: "conversation" } },
      "current",
      context,
    ),
  );
  const childStored = yield* awaited(storage.document(childRecord!.id, "current", context));
  expect(childStored).toMatchObject({ value: { count: 1 }, version: 1 });
  expect(yield* awaited(session.snapshot(V3, child.id, context))).toEqual({
    count: 1,
    migrated: true,
  });
  expect(fork.migrations).toBe(2);
});

describe("Session conversation document forks", () => {
  it("copies the stored value and version without consulting migration definitions or migrated caches", () =>
    Effect.runPromise(copiesStoredValue));
});
