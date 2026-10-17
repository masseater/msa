import { defineDoc, type EntryId, type StorageWrite } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

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

describe("Session conversation document forks", () => {
  it("selects the entry-owning ancestor for as-of copies and the immediate parent for current copies", async () => {
    const { AsOf, Current } = ancestorDocs();
    const { session } = openTestSession();
    const rootId = await createConversation(session);
    let inherited!: EntryId;
    await session.commit(async (tx) => {
      inherited = (await tx.appendEntry(rootId, { kind: "root" })).id;
      (await tx.doc(AsOf, rootId)).value = "root-at-entry";
      (await tx.doc(Current, rootId)).value = "root-current";
    }, context);
    const parent = await session.commit(
      (tx) => tx.forkConversation(rootId, inherited, { ownership: { kind: "ownerless" } }),
      context,
    );
    let parentEntry!: EntryId;
    await session.commit(async (tx) => {
      parentEntry = (await tx.appendEntry(parent.id, { kind: "parent" })).id;
      (await tx.doc(AsOf, parent.id)).value = "parent-at-own-entry";
      (await tx.doc(Current, parent.id)).value = "parent-current";
    }, context);

    const inheritedFork = await session.commit(
      (tx) => tx.forkConversation(parent.id, inherited, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await session.snapshot(AsOf, inheritedFork.id, context)).toEqual({
      value: "root-at-entry",
    });
    expect(await session.snapshot(Current, inheritedFork.id, context)).toEqual({
      value: "parent-current",
    });

    const ownEntryFork = await session.commit(
      (tx) => tx.forkConversation(parent.id, parentEntry, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await session.snapshot(AsOf, ownEntryFork.id, context)).toEqual({
      value: "parent-at-own-entry",
    });
    expect(await session.snapshot(Current, ownEntryFork.id, context)).toEqual({
      value: "parent-current",
    });
  });
});

describe("Session conversation document forks", () => {
  it("copies the stored value and version without consulting migration definitions or migrated caches", async () => {
    const { V1, fork, V3, session, storage } = storedVersionDocs();
    const parentId = await createConversation(session);
    await session.commit(async (tx) => {
      fork.forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      await tx.doc(V1, parentId);
    }, context);
    await session.unloadDocuments();
    expect(await session.snapshot(V3, parentId, context)).toEqual({ count: 1, migrated: true });
    expect(fork.migrations).toBe(1);

    const child = await session.commit(
      (tx) => tx.forkConversation(parentId, fork.forkAt!, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(fork.migrations).toBe(1);
    const childRecord = await storage.findDocument(
      { kind: V1.definition.kind, scope: { kind: "conversation", conversationId: child.id } },
      "current",
      context,
    );
    const childStored = await storage.document(childRecord!.id, "current", context);
    expect(childStored).toMatchObject({ version: 1, value: { count: 1 } });
    expect(await session.snapshot(V3, child.id, context)).toEqual({ count: 1, migrated: true });
    expect(fork.migrations).toBe(2);
  });
});

describe("Session conversation document forks", () => {
  it("coalesces a typed migration and override into the copied creation base", async () => {
    const { V1, calls, V2 } = migratingDocs();
    const { session, storage, publications } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      await tx.doc(V1, parentId);
    }, context);

    const documentReads = storage.documentReadCount;
    const child = await session.commit(async (tx) => {
      const created = await tx.forkConversation(parentId, forkAt, {
        ownership: { kind: "ownerless" },
      });
      const value = await tx.doc(V2, created.id);
      value.count = 9;
      return created;
    }, context);
    await flush();
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
    expect(await session.snapshot(V2, child.id, context)).toEqual({ count: 9, migrated: true });
    const parentRecord = await storage.findDocument(
      { kind: V1.definition.kind, scope: { kind: "conversation", conversationId: parentId } },
      "current",
      context,
    );
    expect((await storage.document(parentRecord!.id, "current", context))!.version).toBe(1);
  });
});

describe("Session conversation document forks", () => {
  it("copies the incarnation alive at the fork point across retirement and recreation", async () => {
    const Doc = defineDoc<{ value: string }>({
      kind: "fork.incarnations",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ value: "initial" }),
    });
    const { session } = openTestSession();
    const parentId = await createConversation(session);
    let oldAt!: EntryId;
    let retiredAt!: EntryId;
    let newAt!: EntryId;
    await session.commit(async (tx) => {
      oldAt = (await tx.appendEntry(parentId, { kind: "old" })).id;
      (await tx.doc(Doc, parentId)).value = "old";
    }, context);
    await session.commit(async (tx) => {
      retiredAt = (await tx.appendEntry(parentId, { kind: "retired" })).id;
      await tx.retireDoc(Doc, parentId);
    }, context);
    await session.commit(async (tx) => {
      newAt = (await tx.appendEntry(parentId, { kind: "new" })).id;
      (await tx.doc(Doc, parentId)).value = "new";
    }, context);

    const oldChild = await session.commit(
      (tx) => tx.forkConversation(parentId, oldAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    const emptyChild = await session.commit(
      (tx) => tx.forkConversation(parentId, retiredAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    const newChild = await session.commit(
      (tx) => tx.forkConversation(parentId, newAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await session.snapshot(Doc, oldChild.id, context)).toEqual({ value: "old" });
    expect(await session.snapshot(Doc, emptyChild.id, context)).toBeUndefined();
    expect(await session.snapshot(Doc, newChild.id, context)).toEqual({ value: "new" });
  });
});

describe("Session conversation document forks", () => {
  it("rejects invisible fork points before admission and remains usable", async () => {
    const { session, storage, publications } = openTestSession();
    const rootId = await createConversation(session);
    let visible!: EntryId;
    let hidden!: EntryId;
    await session.commit(async (tx) => {
      visible = (await tx.appendEntry(rootId, { kind: "visible" })).id;
      hidden = (await tx.appendEntry(rootId, { kind: "hidden" })).id;
    }, context);
    const parent = await session.commit(
      (tx) => tx.forkConversation(rootId, visible, { ownership: { kind: "ownerless" } }),
      context,
    );
    await flush();
    const commits = storage.commits.length;
    const published = publications.length;
    await expect(
      session.commit(
        (tx) => tx.forkConversation(parent.id, hidden, { ownership: { kind: "ownerless" } }),
        context,
      ),
    ).rejects.toThrow(`Entry ${hidden} is not visible`);
    await flush();
    expect(storage.commits).toHaveLength(commits);
    expect(publications).toHaveLength(published);
    const independent = await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await storage.conversation(independent.id, context)).toEqual(independent);
  });
});
