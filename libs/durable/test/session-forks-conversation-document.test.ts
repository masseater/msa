import { defineDoc, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, createConversation, openTestSession } from "./session-support.ts";

function ancestorDocs() {
  const AsOf = defineDoc<{ value: string }>({
    kind: "fork.ancestry.as-of",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "initial" }),
  });
  const Current = defineDoc<{ value: string }>({
    kind: "fork.ancestry.current",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "initial" }),
  });
  return { AsOf, Current };
}

function storedVersionDocs() {
  const V1 = defineDoc<{ count: number }>({
    kind: "fork.stored-version",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ count: 1 }),
  });
  const fork: { migrations: number; forkAt?: EntryId } = { migrations: 0 };
  const V3 = defineDoc<{ count: number; migrated: boolean }>({
    kind: "fork.stored-version",
    version: 3,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ count: 0, migrated: false }),
    migrate: (value, fromVersion) => {
      expect(fromVersion).toBe(1);
      fork.migrations++;
      return { count: value["count"] as number, migrated: true };
    },
  });
  const { session, storage } = openTestSession();
  return { V1, fork, V3, session, storage };
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
            const inherited = (yield* awaited(tx.appendEntry(rootId, { kind: "root" }))).id;
            (yield* awaited(tx.doc(AsOf, rootId))).value = "root-at-entry";
            (yield* awaited(tx.doc(Current, rootId))).value = "root-current";
            return inherited;
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
            const parentEntry = (yield* awaited(tx.appendEntry(parent.id, { kind: "parent" }))).id;
            (yield* awaited(tx.doc(AsOf, parent.id))).value = "parent-at-own-entry";
            (yield* awaited(tx.doc(Current, parent.id))).value = "parent-current";
            return parentEntry;
          }),
        ),
      context,
    ),
  );
  return { AsOf, Current, session, inherited, parent, parentEntry };
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
      { kind: V1.definition.kind, scope: { kind: "conversation", conversationId: child.id } },
      "current",
      context,
    ),
  );
  const childStored = yield* awaited(storage.document(childRecord!.id, "current", context));
  expect(childStored).toMatchObject({ version: 1, value: { count: 1 } });
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
