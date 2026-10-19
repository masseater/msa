import { defineDoc, type EntryId, type StorageWrite } from "@msa/durable";
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

function documentCreates(writes: readonly StorageWrite[]) {
  return writes.filter((write) => write.type === "document.create");
}

function migratingDocs() {
  const V1 = defineDoc<{ count: number }>({
    kind: "fork.override",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ count: 2 }),
  });
  const calls: { checkpoints: number } = { checkpoints: 0 };
  const V2 = defineDoc<{ count: number; migrated: boolean }>({
    kind: "fork.override",
    version: 2,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ count: 0, migrated: false }),
    migrate: (value) => ({ count: value["count"] as number, migrated: true }),
    checkpointWhen: () => {
      calls.checkpoints++;
      return false;
    },
  });
  return { V1, calls, V2 };
}

const coalescesTypedMigrationStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { V1, calls, V2 } = migratingDocs();
  const { session, storage, publications } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(V1, parentId));
            return forkAt;
          }),
        ),
      context,
    ),
  );

  const documentReads = storage.documentReadCount;
  return {
    runPromise,
    V1,
    calls,
    V2,
    session,
    storage,
    publications,
    parentId,
    forkAt,
    documentReads,
  };
});

const coalescesTypedMigrationStep2 = Effect.gen(function* () {
  const {
    runPromise,
    V1,
    calls,
    V2,
    session,
    storage,
    publications,
    parentId,
    forkAt,
    documentReads,
  } = yield* coalescesTypedMigrationStep1;
  const child = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const created = yield* awaited(
              tx.forkConversation(parentId, forkAt, {
                ownership: { kind: "ownerless" },
              }),
            );
            const value = yield* awaited(tx.doc(V2, created.id));
            value.count = 9;
            return created;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(storage.documentReadCount).toBe(documentReads + 1);
  const creates = documentCreates(storage.admittedCommits.at(-1)!);
  expect(creates).toHaveLength(1);
  expect(creates[0]!.content).toMatchObject({
    kind: "base",
    version: 2,
    value: { count: 9, migrated: true },
  });
  expect(calls.checkpoints).toBe(0);
  expect(documentChanges(publications.at(-1)!)).toMatchObject([{ version: 2 }]);
  return { V1, V2, session, storage, parentId, child };
});

const coalescesTypedMigration = Effect.gen(function* () {
  const { V1, V2, session, storage, parentId, child } = yield* coalescesTypedMigrationStep2;
  expect(yield* awaited(session.snapshot(V2, child.id, context))).toEqual({
    count: 9,
    migrated: true,
  });
  const parentRecord = yield* awaited(
    storage.findDocument(
      { kind: V1.definition.kind, scope: { kind: "conversation", conversationId: parentId } },
      "current",
      context,
    ),
  );
  expect((yield* awaited(storage.document(parentRecord!.id, "current", context)))!.version).toBe(1);
});

describe("Session conversation document forks", () => {
  it("coalesces a typed migration and override into the copied creation base", () =>
    Effect.runPromise(coalescesTypedMigration));
});

const copiesIncarnationAliveStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    kind: "fork.incarnations",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "initial" }),
  });
  const { session } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const oldAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const oldAt = (yield* awaited(tx.appendEntry(parentId, { kind: "old" }))).id;
            (yield* awaited(tx.doc(Doc, parentId))).value = "old";
            return oldAt;
          }),
        ),
      context,
    ),
  );
  const retiredAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const retiredAt = (yield* awaited(tx.appendEntry(parentId, { kind: "retired" }))).id;
            yield* awaited(tx.retireDoc(Doc, parentId));
            return retiredAt;
          }),
        ),
      context,
    ),
  );
  return { runPromise, Doc, session, parentId, oldAt, retiredAt };
});

const copiesIncarnationAlive = Effect.gen(function* () {
  const { runPromise, Doc, session, parentId, oldAt, retiredAt } =
    yield* copiesIncarnationAliveStep1;
  const newAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const newAt = (yield* awaited(tx.appendEntry(parentId, { kind: "new" }))).id;
            (yield* awaited(tx.doc(Doc, parentId))).value = "new";
            return newAt;
          }),
        ),
      context,
    ),
  );

  const oldChild = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, oldAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  const emptyChild = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, retiredAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  const newChild = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, newAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(Doc, oldChild.id, context))).toEqual({
    value: "old",
  });
  expect(yield* awaited(session.snapshot(Doc, emptyChild.id, context))).toBeUndefined();
  expect(yield* awaited(session.snapshot(Doc, newChild.id, context))).toEqual({
    value: "new",
  });
});

describe("Session conversation document forks", () => {
  it("copies the incarnation alive at the fork point across retirement and recreation", () =>
    Effect.runPromise(copiesIncarnationAlive));
});

const rejectsInvisibleFork = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications } = openTestSession();
  const rootId = yield* awaited(createConversation(session));
  let visible!: EntryId;
  const hidden = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            visible = (yield* awaited(tx.appendEntry(rootId, { kind: "visible" }))).id;
            const hidden = (yield* awaited(tx.appendEntry(rootId, { kind: "hidden" }))).id;
            return hidden;
          }),
        ),
      context,
    ),
  );
  const parent = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(rootId, visible, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  yield* flush;
  const commits = storage.commits.length;
  const published = publications.length;
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.forkConversation(parent.id, hidden, { ownership: { kind: "ownerless" } }),
        context,
      ),
    ).rejects.toThrow(`Entry ${hidden} is not visible`),
  );
  yield* flush;
  expect(storage.commits).toHaveLength(commits);
  expect(publications).toHaveLength(published);
  const independent = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  expect(yield* awaited(storage.conversation(independent.id, context))).toEqual(independent);
});

describe("Session conversation document forks", () => {
  it("rejects invisible fork points before admission and remains usable", () =>
    Effect.runPromise(rejectsInvisibleFork));
});
