import { describe, expect, it } from "vite-plus/test";

import { setupLive, LiveDoc, MemberDoc } from "./session-documents-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

describe("Session document transactions", () => {
  it("retires without acquisition and recreates both existing and absent addresses", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    await flush();
    const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
    await session.unloadDocuments();
    await session.commit(async (tx) => {
      const retired = tx.retireDoc(LiveDoc, conversationId);
      const replacement = tx.doc(LiveDoc, conversationId);
      const [live] = await Promise.all([replacement, retired]);
      live.message = "replacement";
    }, context);
    const existingWrites = storage.commits.at(-1)!;
    expect(existingWrites).toHaveLength(2);
    expect(existingWrites).toContainEqual({ type: "document.retire", id: oldId });
    expect(existingWrites).toContainEqual(
      expect.objectContaining({
        type: "document.create",
        record: expect.objectContaining({ kind: "test.live" }),
      }),
    );

    await session.commit(async (tx) => {
      const retired = tx.retireDoc(MemberDoc, "absent");
      const replacement = tx.doc(MemberDoc, "absent", "seed");
      const [member] = await Promise.all([replacement, retired]);
      member.hits = 1;
    }, context);
    const absentWrites = storage.commits.at(-1)!;
    expect(absentWrites.filter((write) => write.type === "document.retire")).toHaveLength(0);
    expect(absentWrites.filter((write) => write.type === "document.create")).toHaveLength(1);
    expect(await session.snapshot(MemberDoc, "absent", context)).toEqual({ seed: "seed", hits: 1 });
  });
});

describe("Session document transactions", () => {
  it("retires the existing incarnation when retirement races a pending acquisition", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    await flush();
    const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
    await session.commit(async (tx) => {
      const acquired = tx.doc(LiveDoc, conversationId);
      const retired = tx.retireDoc(LiveDoc, conversationId);
      (await acquired).message = "final";
      await retired;
    }, context);
    const firstWrites = storage.commits.at(-1)!;
    expect(firstWrites).toHaveLength(2);
    expect(firstWrites).toContainEqual({
      type: "document.change",
      id: oldId,
      content: expect.objectContaining({ kind: "delta" }),
    });
    expect(firstWrites).toContainEqual({ type: "document.retire", id: oldId });
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBeUndefined();

    await session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "second";
    }, context);
    await flush();
    const secondId = documentChanges(publications.at(-1)!)[0]!.record.id;
    await session.commit(async (tx) => {
      const acquired = tx.doc(LiveDoc, conversationId);
      const retired = tx.retireDoc(LiveDoc, conversationId);
      const recreated = tx.doc(LiveDoc, conversationId);
      const [old, fresh] = await Promise.all([acquired, recreated, retired]);
      expect(fresh).not.toBe(old);
      fresh!.message = "third";
    }, context);
    const writes = storage.commits.at(-1)!;
    expect(writes).toHaveLength(2);
    expect(writes).toContainEqual({ type: "document.retire", id: secondId });
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: "document.create",
        record: expect.objectContaining({ kind: "test.live" }),
      }),
    );
    expect((await session.snapshot(LiveDoc, conversationId, context))!.message).toBe("third");
  });
});

describe("Session document transactions", () => {
  it("reloads an unloaded document from Storage", async () => {
    const { session, conversationId } = await setupLive();
    const loaded = (await session.snapshot(LiveDoc, conversationId, context))!;
    await session.unloadDocuments();
    const reloaded = (await session.snapshot(LiveDoc, conversationId, context))!;
    expect(reloaded).not.toBe(loaded);
    expect(reloaded).toEqual(loaded);
    await session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).items.push("c");
    }, context);
    await session.unloadDocuments();
    expect((await session.snapshot(LiveDoc, conversationId, context))!.items).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("delivers complete publications synchronously after adoption", async () => {
    const { session, publications, conversationId } = await setupLive();
    const published = publications.length;
    let listenerContext: typeof context | undefined;
    const unsubscribe = session.subscribeCommits((_publication, deliveredContext) => {
      listenerContext = deliveredContext;
    });
    const result = await session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "m";
      return "done";
    }, context);
    expect(result).toBe("done");
    expect(listenerContext).toBe(context);
    expect(publications.length).toBe(published + 1);
    unsubscribe();
  });

  it("publishes close synchronously and supports unsubscription", async () => {
    const { session } = openTestSession();
    const calls: string[] = [];
    session.subscribeClose(() => calls.push("active"));
    const unsubscribe = session.subscribeClose(() => calls.push("removed"));
    unsubscribe();
    await session.close(context);
    expect(calls).toEqual(["active"]);
  });
});

describe("Session document transactions", () => {
  it("settles admitted commits before close and rejects later admission", async () => {
    const { session, storage, conversationId } = await setupLive();
    const gate = storage.holdCommits();
    const commit = session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "admitted";
    }, context);
    await gate.entered;
    const queued = session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "queued";
    }, context);
    const admittedSnapshot = session.snapshot(MemberDoc, "absent", context);
    const closed = session.close(context);
    await expect(session.commit(() => undefined, context)).rejects.toThrow("closed");
    await expect(session.snapshot(LiveDoc, conversationId, context)).rejects.toThrow("closed");
    gate.release();
    await commit;
    await queued;
    expect(await admittedSnapshot).toBeUndefined();
    await closed;
    const stored = await storage
      .findDocument(
        { kind: "test.live", scope: { kind: "conversation", conversationId } },
        "current",
        context,
      )
      .catch((error: unknown) => error);
    expect(stored).toBeInstanceOf(Error);
  });
});
