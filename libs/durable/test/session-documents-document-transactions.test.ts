import type { Draft, JsonValue } from "@msa/chord";
import { defineDoc, type JsonObject, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import {
  setupLive,
  LiveDoc,
  type Live,
  CounterDoc,
  type Counter,
} from "./session-documents-support.ts";
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

const RewindableLiveDoc = defineDoc<Live>({
  kind: "test.live",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ items: [], nested: { count: 0 }, other: { label: "x" } }),
});

const LiveDocV2 = defineDoc<Live>({
  kind: "test.live",
  version: 2,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [], nested: { count: 0 }, other: { label: "x" } }),
});

describe("Session document transactions", () => {
  it("does not initialize or mint for an absent acquisition that finishes after settlement", async () => {
    const { session, storage } = openTestSession();
    let initialized = 0;
    const LateDoc = defineDoc<Counter>({
      kind: "test.late",
      version: 1,
      scope: "session",
      initial: () => {
        initialized++;
        return { count: 0 };
      },
    });
    const gate = storage.holdFindDocument();
    const mints = storage.mintCount;
    let pending: Promise<unknown> | undefined;
    const commit = session.commit((tx) => {
      pending = tx.doc(LateDoc);
    }, context);
    await gate.entered;
    gate.release();
    await expect(commit).rejects.toThrow("pending Tx operations");
    await expect(pending).rejects.toThrow("Transaction has settled");
    expect(initialized).toBe(0);
    expect(storage.mintCount).toBe(mints);
  });

  it("rejects with the callback error when it fails with a pending acquisition", async () => {
    const { session, storage, conversationId } = await setupLive();
    await session.unloadDocuments();
    const gate = storage.holdFindDocument();
    let pending: Promise<unknown> | undefined;
    const commit = session.commit((tx) => {
      pending = tx.doc(LiveDoc, conversationId);
      throw new Error("callback failed");
    }, context);
    await gate.entered;
    gate.release();
    await expect(commit).rejects.toThrow("callback failed");
    await expect(pending).rejects.toThrow("Transaction has settled");
  });
});

describe("Session document transactions", () => {
  it("rejects Tx use after the callback settles", async () => {
    const { session, conversationId } = await setupLive();
    let captured: Parameters<Parameters<typeof session.commitWith>[0]>[0] | undefined;
    await session.commitWith((tx) => {
      captured = tx;
    }, context);
    await expect(captured!.doc(LiveDoc, conversationId)).rejects.toThrow("Transaction has settled");
    await expect(captured!.conversation(conversationId)).rejects.toThrow("Transaction has settled");
    expect(() => captured!.setTask({} as never)).toThrow("Transaction has settled");
  });

  it("rejects tokens whose semantics or version disagree with the stored incarnation", async () => {
    const { session, conversationId } = await setupLive();
    await expect(session.snapshot(RewindableLiveDoc, conversationId, context)).rejects.toThrow(
      "does not match the supplied definition semantics",
    );
    await expect(
      session.commit(async (tx) => {
        await tx.doc(RewindableLiveDoc, conversationId);
      }, context),
    ).rejects.toThrow("does not match the supplied definition semantics");
    await expect(
      session.commit(async (tx) => {
        await tx.doc(LiveDocV2, conversationId);
      }, context),
    ).rejects.toThrow("requires migration from version 1");
  });
});

describe("Session document transactions", () => {
  it("rejects non-JSON initializer values and draft placements before Storage admission", async () => {
    const { session, storage } = openTestSession();
    const conversationId = await createConversation(session);
    const DateDoc = defineDoc<JsonObject>({
      kind: "test.date",
      version: 1,
      scope: "session",
      initial: () => ({ at: new Date() }) as unknown as JsonObject,
    });
    await expect(
      session.commit(async (tx) => {
        await tx.doc(DateDoc);
      }, context),
    ).rejects.toThrow("strict JSON");
    const commits = storage.commits.length;
    await expect(
      session.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, conversationId);
        live.items.push(undefined as unknown as string);
      }, context),
    ).rejects.toThrow("strict JSON");
    expect(storage.commits.length).toBe(commits);
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBeUndefined();
  });
});

describe("Session document transactions", () => {
  it("rolls back prepared documents when batch assembly fails", async () => {
    const { session, storage, conversationId } = await setupLive();
    await session.commit(async (tx) => {
      (await tx.doc(CounterDoc)).count = 1;
    }, context);
    const live = await session.snapshot(LiveDoc, conversationId, context);
    const counter = await session.snapshot(CounterDoc, context);
    const commits = storage.commits.length;
    await expect(
      session.commitWith(async (tx) => {
        (await tx.doc(LiveDoc, conversationId)).message = "lost";
        (await tx.doc(CounterDoc)).count = 2;
        // Replacing a missing task fails during assembly, after every change was prepared.
        tx.setTask({
          id: idFromNumber<TaskId<JsonValue>>(999),
          conversationId,
          kind: "missing",
          version: 1,
          input: null,
          background: false,
          abortRequested: false,
          state: { status: "pending", checkpoint: { phase: "start" } },
        });
      }, context),
    ).rejects.toThrow("Task 999 does not exist");
    expect(storage.commits.length).toBe(commits);
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBe(live);
    expect(await session.snapshot(CounterDoc, context)).toBe(counter);
    await session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "next";
      (await tx.doc(CounterDoc)).count = 3;
    }, context);
    expect((await session.snapshot(CounterDoc, context))!.count).toBe(3);
  });
});

describe("Session document transactions", () => {
  it("fails the Session after a Storage failure and publishes nothing", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    await flush();
    const before = (await session.snapshot(LiveDoc, conversationId, context))!;
    const published = publications.length;
    storage.failNextCommit(new Error("disk vanished"));
    await expect(
      session.commit(async (tx) => {
        (await tx.doc(LiveDoc, conversationId)).message = "uncertain";
      }, context),
    ).rejects.toThrow("disk vanished");
    await flush();
    expect(publications.length).toBe(published);
    expect(before.message).toBeUndefined();
    await expect(session.snapshot(LiveDoc, conversationId, context)).rejects.toMatchObject({
      name: "SessionFailed",
    });
    await expect(session.commit(() => undefined, context)).rejects.toMatchObject({
      name: "SessionFailed",
    });
    await session.close(context);
  });

  it("keeps the previous revision unchanged through Storage settlement", async () => {
    const { session, storage, conversationId } = await setupLive();
    const before = (await session.snapshot(LiveDoc, conversationId, context))!;
    const copy = structuredClone(before);
    const gate = storage.holdCommits();
    const commit = session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.items.push("c");
      live.nested.count = 9;
    }, context);
    await gate.entered;
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBe(before);
    expect(before).toEqual(copy);
    gate.release();
    await commit;
    const after = (await session.snapshot(LiveDoc, conversationId, context))!;
    expect(after.items).toEqual(["a", "b", "c"]);
    expect(before).toEqual(copy);
  });
});

describe("Session document transactions", () => {
  it("retires documents and creates a new incarnation at the same address", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    await flush();
    const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
    let replacement: Draft<Live> | undefined;
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.message = "final";
      await tx.retireDoc(LiveDoc, conversationId);
      replacement = await tx.doc(LiveDoc, conversationId);
      expect(replacement).not.toBe(live);
      replacement.message = "new";
    }, context);
    const writes = storage.commits.at(-1)!;
    expect(writes).toHaveLength(3);
    expect(writes).toContainEqual(expect.objectContaining({ type: "document.change", id: oldId }));
    expect(writes).toContainEqual({ type: "document.retire", id: oldId });
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: "document.create",
        record: expect.objectContaining({ kind: "test.live" }),
      }),
    );
    await flush();
    const publication = publications.at(-1)!;
    const [retired, created] = documentChanges(publication);
    expect(retired).toMatchObject({ record: { id: oldId }, value: null, ops: [] });
    expect(retired!.record.retiredAt).toBe(publication.seq);
    expect(created!.record.id).not.toBe(oldId);
    expect(created!.record.createdAt).toBe(publication.seq);
    expect(created).toMatchObject({ value: { message: "new", items: [] }, ops: [] });
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBe(created!.value);

    await session.commit((tx) => tx.retireDoc(LiveDoc, conversationId), context);
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBeUndefined();
    await session.unloadDocuments();
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBeUndefined();
    // Retiring an absent address is a no-op.
    const commits = storage.commits.length;
    await session.commit((tx) => tx.retireDoc(LiveDoc, conversationId), context);
    expect(storage.commits.length).toBe(commits);
  });
});
