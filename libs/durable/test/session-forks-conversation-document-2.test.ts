import { type ConversationId, defineDoc, type EntryId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { context, createConversation, flush, openTestSession } from "./session-support.ts";

function sourceWriteDocs() {
  const Current = defineDoc<{ value: string }>({
    kind: "fork.same-transaction-current",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "committed" }),
  });
  const AsOf = defineDoc<{ value: string }>({
    kind: "fork.same-transaction-as-of",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "committed" }),
  });
  return { Current, AsOf };
}

function failingCheckpointDocs() {
  const Copied = defineDoc<{ value: string }>({
    kind: "fork.rollback.copied",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "copied" }),
  });
  const toggle: { failCheckpoint: boolean } = { failCheckpoint: true };
  const Failure = defineDoc<{ count: number }>({
    kind: "fork.rollback.failure",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: () => {
      if (toggle.failCheckpoint) throw new Error("checkpoint failed");
      return false;
    },
  });
  return { Copied, toggle, Failure };
}

describe("Session conversation document forks", () => {
  it("rejects duplicate as-of and current selections for one child address before admission", async () => {
    const AsOf = defineDoc<{ value: string }>({
      kind: "fork.duplicate-policy",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ value: "as-of" }),
    });
    const Current = defineDoc<{ value: string }>({
      kind: "fork.duplicate-policy",
      version: 1,
      scope: "conversation",
      history: "latest",
      fork: "current",
      initial: () => ({ value: "current" }),
    });
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    let oldAt!: EntryId;
    await session.commit(async (tx) => {
      oldAt = (await tx.appendEntry(parentId, { kind: "old" })).id;
      await tx.doc(AsOf, parentId);
    }, context);
    await session.commit((tx) => tx.retireDoc(AsOf, parentId), context);
    await session.commit((tx) => tx.doc(Current, parentId).then(() => undefined), context);
    const commits = storage.commits.length;
    await expect(
      session.commit(
        (tx) => tx.forkConversation(parentId, oldAt, { ownership: { kind: "ownerless" } }),
        context,
      ),
    ).rejects.toThrow("Fork selects multiple source documents");
    expect(storage.commits).toHaveLength(commits);
    const independent = await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await storage.conversation(independent.id, context)).toEqual(independent);
  });
});

describe("Session conversation document forks", () => {
  it("rejects current and as-of source writes in the fork transaction", async () => {
    const { Current, AsOf } = sourceWriteDocs();
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      await tx.doc(Current, parentId);
      await tx.doc(AsOf, parentId);
    }, context);
    const commits = storage.commits.length;
    await expect(
      session.commit(async (tx) => {
        (await tx.doc(Current, parentId)).value = "before-fork";
        await tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } });
      }, context),
    ).rejects.toThrow("Cannot change fork source document");
    await expect(
      session.commit(async (tx) => {
        await tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } });
        (await tx.doc(Current, parentId)).value = "after-fork";
      }, context),
    ).rejects.toThrow("Cannot change fork source document");
    await expect(
      session.commit(async (tx) => {
        (await tx.doc(AsOf, parentId)).value = "as-of-write";
        await tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } });
      }, context),
    ).rejects.toThrow("Cannot change fork source document");
    expect(storage.commits).toHaveLength(commits);
    expect(await session.snapshot(Current, parentId, context)).toEqual({ value: "committed" });
    const child = await session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(await session.snapshot(Current, child.id, context)).toEqual({ value: "committed" });
  });
});

describe("Session conversation document forks", () => {
  it("rolls every copied base back when later pre-admission assembly fails", async () => {
    const { Copied, toggle, Failure } = failingCheckpointDocs();
    const { session, storage, publications } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      await tx.doc(Copied, parentId);
      await tx.doc(Failure);
    }, context);
    await flush();
    const commits = storage.commits.length;
    const published = publications.length;
    let childId!: ConversationId;
    await expect(
      session.commit(async (tx) => {
        childId = (
          await tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } })
        ).id;
        (await tx.doc(Failure)).count = 1;
      }, context),
    ).rejects.toThrow("checkpoint failed");
    await flush();
    expect(storage.commits).toHaveLength(commits);
    expect(publications).toHaveLength(published);
    expect(await storage.conversation(childId, context)).toBeUndefined();
    toggle.failCheckpoint = false;
    await session.commit(async (tx) => {
      (await tx.doc(Failure)).count = 2;
    }, context);
    expect(await session.snapshot(Failure, context)).toEqual({ count: 2 });
    expect(await session.snapshot(Copied, parentId, context)).toEqual({ value: "copied" });
  });
});

describe("Session conversation document forks", () => {
  it("fails the Session on a rejected fork commit, which leaves no effect", async () => {
    const Doc = defineDoc<{ value: string }>({
      kind: "fork.storage-rejected",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ value: "source" }),
    });
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      await tx.doc(Doc, parentId);
    }, context);
    let rejectedChildId!: ConversationId;
    const rejection = new Error("copy rejected");
    storage.failNextCommit(rejection);
    await expect(
      session.commit(async (tx) => {
        rejectedChildId = (
          await tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } })
        ).id;
      }, context),
    ).rejects.toBe(rejection);
    await expect(
      session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
    ).rejects.toMatchObject({ name: "SessionFailed", cause: rejection });
    // The failed Session closed its Storage; reopened, it holds nothing of the batch.
    expect(await session.closed).toEqual({ reason: "failed", error: rejection });
    expect(await storage.reopen().conversation(rejectedChildId, context)).toBeUndefined();
  });
});

describe("Session conversation document forks", () => {
  it("retires a copied document and can recreate the address in the fork transaction", async () => {
    const Doc = defineDoc<{ value: string }>({
      kind: "fork.retire-recreate",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ value: "fresh" }),
    });
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      (await tx.doc(Doc, parentId)).value = "copied";
    }, context);
    const child = await session.commit(async (tx) => {
      const created = await tx.forkConversation(parentId, forkAt, {
        ownership: { kind: "ownerless" },
      });
      await tx.retireDoc(Doc, created.id);
      (await tx.doc(Doc, created.id)).value = "replacement";
      return created;
    }, context);
    const writes = storage.commits.at(-1)!;
    expect(writes.filter((write) => write.type === "document.copy")).toHaveLength(1);
    expect(writes.filter((write) => write.type === "document.create")).toHaveLength(1);
    expect(writes.filter((write) => write.type === "document.retire")).toHaveLength(1);
    expect(await session.snapshot(Doc, child.id, context)).toEqual({ value: "replacement" });
  });
});
