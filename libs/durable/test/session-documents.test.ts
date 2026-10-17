import type { Draft } from "@msa/chord";
import { describe, expect, it } from "vite-plus/test";

import {
  setupLive,
  LiveDoc,
  liveInitCount,
  type Live,
  MemberDoc,
  seeds,
  CounterDoc,
} from "./session-documents-support.ts";
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

describe("Session document transactions", () => {
  it("creates an initial base on first access and adopts it after Storage success", async () => {
    const { session, storage, publications } = openTestSession();
    const conversationId = await createConversation(session);
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.message = "hello";
    }, context);
    const writes = storage.commits.at(-1)!;
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      type: "document.create",
      record: {
        kind: "test.live",
        scope: { kind: "conversation", conversationId },
        history: "latest",
        fork: "initial",
      },
      content: {
        kind: "base",
        version: 1,
        value: { message: "hello", items: [], nested: { count: 0 } },
      },
    });
    const snapshot = await session.snapshot(LiveDoc, conversationId, context);
    expect(snapshot).toEqual({
      message: "hello",
      items: [],
      nested: { count: 0 },
      other: { label: "x" },
    });
    await flush();
    const publication = publications.at(-1)!;
    const published = documentChanges(publication)[0]!;
    expect(published.record.createdAt).toBe(publication.seq);
    expect(published.value).toBe(snapshot);
    expect(published.conversationId).toBe(conversationId);
    const create = storage.admittedCommits
      .at(-1)!
      .find((write) => write.type === "document.create")!;
    expect(create.content.value).toBe(published.value);
  });
});

describe("Session document transactions", () => {
  it("never creates on snapshot and returns undefined when absent", async () => {
    const { session, storage } = openTestSession();
    const conversationId = await createConversation(session);
    const before = storage.commits.length;
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBeUndefined();
    expect(await session.snapshot(CounterDoc, context)).toBeUndefined();
    expect(await session.snapshot(MemberDoc, "k", context)).toBeUndefined();
    expect(storage.commits.length).toBe(before);
    expect(storage.mintCount).toBe(1);
  });

  it("returns shared immutable snapshots and keeps prior revisions stable", async () => {
    const { session, conversationId } = await setupLive();
    const first = (await session.snapshot(LiveDoc, conversationId, context))!;
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBe(first);
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.nested.count = 1;
    }, context);
    const second = (await session.snapshot(LiveDoc, conversationId, context))!;
    expect(second).not.toBe(first);
    expect(first.nested.count).toBe(0);
    expect(second.nested.count).toBe(1);
    // Unchanged subtrees are structurally shared between immutable revisions.
    expect(second.items).toBe(first.items);
    expect(second.other).toBe(first.other);
  });
});

describe("Session document transactions", () => {
  it("adopts by pointer swap and shares operation payloads with the published revision", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.other = { label: "y" };
      live.items.push("c");
    }, context);
    await flush();
    const snapshot = (await session.snapshot(LiveDoc, conversationId, context))!;
    const published = documentChanges(publications.at(-1)!)[0]!;
    expect(published.value).toBe(snapshot);
    const admitted = storage.admittedCommits
      .at(-1)!
      .find((write) => write.type === "document.change")!;
    expect(admitted.content.kind).toBe("delta");
    if (admitted.content.kind !== "delta") throw new Error("Expected delta");
    expect(published.ops).toBe(admitted.content.ops);
    const set = published.ops.find((op) => op[0] === "s");
    expect(set).toEqual(["s", ["other"], { label: "y" }]);
    // Trusted immutability: the Session makes no second copy of operation payloads.
    expect(set![2]).toBe(snapshot.other);
  });

  it("copies assigned values per placement", async () => {
    const { session, conversationId } = await setupLive();
    const value = { label: "shared" };
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.other = value;
      (live as Draft<Live> & { copy?: { label: string } }).copy = value;
      value.label = "mutated";
    }, context);
    const snapshot = (await session.snapshot(LiveDoc, conversationId, context)) as Live & {
      copy: { label: string };
    };
    expect(snapshot.other).toEqual({ label: "shared" });
    expect(snapshot.copy).toEqual({ label: "shared" });
    expect(snapshot.copy).not.toBe(snapshot.other);
    expect(snapshot.other).not.toBe(value);
  });
});

describe("Session document transactions", () => {
  it("suppresses writes and publications for empty batches", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    await flush();
    const commits = storage.commits.length;
    const published = publications.length;
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      live.nested.count = 0;
      live.items.push("z");
      live.items.pop();
    }, context);
    await flush();
    expect(storage.commits.length).toBe(commits);
    expect(publications.length).toBe(published);
  });

  it("writes and publishes replayable nonempty structural no-ops", async () => {
    const { session, storage, publications, conversationId } = await setupLive();
    const before = (await session.snapshot(LiveDoc, conversationId, context))!;
    await session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, conversationId);
      const first = live.items.shift()!;
      live.items.unshift(first);
    }, context);
    await flush();
    const writes = storage.commits.at(-1)!;
    expect(writes[0]).toMatchObject({ type: "document.change", content: { kind: "delta" } });
    const after = (await session.snapshot(LiveDoc, conversationId, context))!;
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
    expect(documentChanges(publications.at(-1)!)[0]!.ops.length).toBeGreaterThan(0);
  });
});

describe("Session document transactions", () => {
  it("revokes escaped drafts when the callback settles", async () => {
    const { session, conversationId } = await setupLive();
    let escaped: Draft<Live> | undefined;
    let items: Draft<string[]> | undefined;
    await session.commit(async (tx) => {
      escaped = await tx.doc(LiveDoc, conversationId);
      items = escaped.items;
      escaped.message = "inside";
    }, context);
    expect(() => escaped!.message).toThrow();
    expect(() => {
      escaped!.message = "outside";
    }).toThrow();
    expect(() => items!.length).toThrow();
    expect(() => items!.push("outside")).toThrow();
    expect((await session.snapshot(LiveDoc, conversationId, context))!.message).toBe("inside");

    const returned = await session.commit((tx) => tx.doc(LiveDoc, conversationId), context);
    expect(() => returned.message).toThrow();
  });

  it("aborts every change when the callback fails", async () => {
    const { session, storage, conversationId } = await setupLive();
    const before = (await session.snapshot(LiveDoc, conversationId, context))!;
    const commits = storage.commits.length;
    await expect(
      session.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, conversationId);
        const counter = await tx.doc(CounterDoc);
        live.message = "lost";
        counter.count = 5;
        throw new Error("callback failed");
      }, context),
    ).rejects.toThrow("callback failed");
    expect(storage.commits.length).toBe(commits);
    expect(await session.snapshot(LiveDoc, conversationId, context)).toBe(before);
    expect(await session.snapshot(CounterDoc, context)).toBeUndefined();
    await session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "kept";
    }, context);
    expect((await session.snapshot(LiveDoc, conversationId, context))!.message).toBe("kept");
  });
});

describe("Session document transactions", () => {
  it("memoizes concurrent duplicate acquisition and initializes once", async () => {
    const { session, storage } = openTestSession();
    const conversationId = await createConversation(session);
    const initCount = liveInitCount;
    const mints = storage.mintCount;
    await session.commit(async (tx) => {
      const [first, second] = await Promise.all([
        tx.doc(LiveDoc, conversationId),
        tx.doc(LiveDoc, conversationId),
      ]);
      expect(first).toBe(second);
      expect(await tx.doc(LiveDoc, conversationId)).toBe(first);
      first.message = "once";
    }, context);
    expect(liveInitCount).toBe(initCount + 1);
    expect(storage.mintCount).toBe(mints + 1);
    expect(
      storage.commits.at(-1)!.filter((write) => write.type === "document.create"),
    ).toHaveLength(1);
  });

  it("uses the first family seed and ignores seeds for existing members", async () => {
    const { session } = openTestSession();
    seeds.length = 0;
    await session.commit(async (tx) => {
      const first = await tx.doc(MemberDoc, "k", "first");
      const second = await tx.doc(MemberDoc, "k", "second");
      expect(second).toBe(first);
      first.hits++;
    }, context);
    await session.commit(async (tx) => {
      (await tx.doc(MemberDoc, "k", "third")).hits++;
      (await tx.doc(MemberDoc, "other", "fourth")).hits++;
    }, context);
    expect(seeds).toEqual(["first", "fourth"]);
    expect(await session.snapshot(MemberDoc, "k", context)).toEqual({ seed: "first", hits: 2 });
    expect(await session.snapshot(MemberDoc, "other", context)).toEqual({
      seed: "fourth",
      hits: 1,
    });
  });
});

describe("Session document transactions", () => {
  it("rejects a callback that succeeds with a pending acquisition and drains it", async () => {
    const { session, storage, conversationId } = await setupLive();
    await session.unloadDocuments();
    const gate = storage.holdFindDocument();
    const commits = storage.commits.length;
    let pending: Promise<unknown> | undefined;
    const commit = session.commit((tx) => {
      pending = tx.doc(LiveDoc, conversationId);
    }, context);
    await gate.entered;
    let settled = false;
    void commit.catch(() => {
      settled = true;
    });
    await flush();
    // The line stays held until the late acquisition settles.
    expect(settled).toBe(false);
    gate.release();
    await expect(commit).rejects.toThrow("pending Tx operations");
    await expect(pending).rejects.toThrow("Transaction has settled");
    expect(storage.commits.length).toBe(commits);
    await session.commit(async (tx) => {
      (await tx.doc(LiveDoc, conversationId)).message = "after";
    }, context);
    expect((await session.snapshot(LiveDoc, conversationId, context))!.message).toBe("after");
  });
});
