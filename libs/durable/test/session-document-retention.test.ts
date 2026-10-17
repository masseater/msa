import type { Context } from "@msa/chord";
import { defineDoc, defineDocFamily, type StorageWrite } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { SessionImpl } from "../src/session/session.ts";
import {
  settleLine,
  type Counter,
  CounterDoc,
  bump,
  open,
} from "./session-document-retention-support.ts";
import { ControlledStorage, context, createConversation } from "./session-support.ts";
import { deferred, eventually } from "./task-support.ts";

const RewindableDoc = defineDoc<Counter>({
  kind: "test.retention.rewindable",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ count: 0 }),
});

/** A third-party conversation family: one member per event. */
const EventDoc = defineDocFamily<{ seq: number }, number>({
  kind: "test.retention.event",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  family: true,
  initial: (seq) => ({ seq }),
});

const SessionCounterDoc = defineDoc<Counter>({
  kind: "test.retention.session-counter",
  version: 1,
  scope: "session",
  initial: () => ({ count: 0 }),
});

describe("document cache retention", () => {
  it("evicts an unattached document once its retention passed, and loads it again with the same value", async () => {
    const { session, storage, clock, sizes } = open(60_000);
    const conversationId = await createConversation(session);
    await bump(session, conversationId, 3);
    expect(sizes().cached).toBeGreaterThan(0);
    // Not yet: inside the retention period.
    clock.now += 59_000;
    await bump(session, conversationId, 0);
    await settleLine(session);
    expect(sizes().cached).toBeGreaterThan(0);
    // Past it, with no use since: the next commit evicts it.
    clock.now += 61_000;
    await session.commit(async () => {}, context);
    await session.commit(async (tx) => {
      await tx.doc(SessionCounterDoc);
    }, context);
    await settleLine(session);
    const reads = storage.documentReadCount;
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 3 });
    expect(storage.documentReadCount).toBeGreaterThan(reads);
    await session.close(context);
  });

  it("evicts with retention 0 right after use, on the line", async () => {
    const { session, sizes } = open(0);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    await eventually(async () => {
      await settleLine(session);
      return sizes().cached === 0;
    });
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 1 });
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("never evicts a document a watch or a document state observes, and evicts it once the last detaches", async () => {
    const { session, storage, clock, sizes } = open(1_000);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    const watch = (await session.watchDoc(CounterDoc, conversationId, context))!;
    const state = (await session.documentState(CounterDoc, conversationId, context))!;
    const seen: number[] = [];
    watch.start((value) => {
      seen.push(value?.count ?? -1);

      return Promise.resolve();
    });
    clock.now += 1_000_000;
    await bump(session, conversationId);
    await settleLine(session);
    // Still cached: a read long after its retention passed loads nothing from Storage.
    expect(state.value?.count).toBe(2);
    await eventually(() => seen.includes(2));
    const reads = storage.documentReadCount;
    clock.now += 1_000_000;
    await session.commit(async (tx) => {
      await tx.doc(SessionCounterDoc);
    }, context);
    await settleLine(session);
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 2 });
    expect(storage.documentReadCount).toBe(reads);
    await watch.stop();
    clock.now += 1_000_000;
    await bump(session, conversationId);
    await settleLine(session);
    expect(state.value?.count).toBe(3);
    state.dispose();
    clock.now += 1_000_000;
    await session.commit(async () => {}, context);
    await session.commit(async (tx) => {
      await tx.doc(SessionCounterDoc);
    }, context);
    await settleLine(session);
    // The session document was just used; the counter is gone.
    expect(sizes().cached).toBe(1);
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("never takes a tracker from a transaction that holds it", async () => {
    const { session, clock } = open(0);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    const inside = deferred();
    const release = deferred();
    const commit = session.commit(async (tx) => {
      const draft = await tx.doc(CounterDoc, conversationId);
      inside.resolve();
      await release.promise;
      draft.count += 10;
    }, context);
    await inside.promise;
    // Retention passes while the transaction holds the document; eviction waits on the line behind it.
    clock.now += 1_000_000;
    release.resolve();
    await commit;
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 11 });
    await bump(session, conversationId);
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 12 });
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("writes after a reload continue the stored deltas and bases", async () => {
    const { session, storage } = open(0);
    const conversationId = await createConversation(session);
    const writes: StorageWrite[][] = [];
    const commit = storage.commit.bind(storage);
    storage.commit = (batch: readonly StorageWrite[], commitContext: Context) => {
      writes.push([...batch]);
      return commit(batch, commitContext);
    };
    for await (const _ of Array.from({ length: 5 })) {
      await bump(session, conversationId);
      await settleLine(session);
    }
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 5 });
    // Every bump after the first is a change of the same incarnation, never a second creation.
    const creations = writes
      .flat()
      .filter(
        (write) =>
          write.type === "document.create" && write.record.kind === CounterDoc.definition.kind,
      );
    expect(creations).toHaveLength(1);
    await session.close(context);
    // And a fresh Session over the same storage reads the same value.
    const reopened = new SessionImpl(storage.reopen(), Date.now, () => 0);
    expect(await reopened.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 5 });
    await reopened.close(context);
  });
});

describe("document cache retention", () => {
  it("keeps history and forks of rewindable documents after eviction", async () => {
    const { session } = open(0);
    const conversationId = await createConversation(session);
    const first = await session.commit(async (tx) => {
      (await tx.doc(RewindableDoc, conversationId)).count = 1;
      return (await tx.appendEntry(conversationId, { kind: "note", data: null })).id;
    }, context);
    await settleLine(session);
    const second = await session.commit(async (tx) => {
      (await tx.doc(RewindableDoc, conversationId)).count = 2;
      return (await tx.appendEntry(conversationId, { kind: "note", data: null })).id;
    }, context);
    await settleLine(session);
    expect(await session.snapshotAsOf(RewindableDoc, conversationId, first, context)).toEqual({
      count: 1,
    });
    expect(await session.snapshotAsOf(RewindableDoc, conversationId, second, context)).toEqual({
      count: 2,
    });
    const fork = await session.commit(
      async (tx) =>
        (await tx.forkConversation(conversationId, first, { ownership: { kind: "ownerless" } })).id,
      context,
    );
    await settleLine(session);
    expect(await session.snapshot(RewindableDoc, fork, context)).toEqual({ count: 1 });
    expect(await session.snapshot(RewindableDoc, conversationId, context)).toEqual({ count: 2 });
    await session.close(context);
  });

  it("bounds a third-party family with a member per event", async () => {
    const { session, sizes } = open(0);
    const conversationId = await createConversation(session);
    for await (const seq of Array.from({ length: 200 }, (_, i) => i)) {
      await session.commit(async (tx) => {
        await tx.doc(EventDoc, conversationId, String(seq), seq);
      }, context);
    }
    await eventually(async () => {
      await settleLine(session);
      return sizes().cached === 0;
    });
    expect(await session.snapshot(EventDoc, conversationId, "123", context)).toEqual({ seq: 123 });
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("keeps the cache of a long-lived Session bounded across many conversations", async () => {
    const { session, clock, sizes } = open(10_000);
    for await (const _ of Array.from({ length: 300 })) {
      const conversationId = await createConversation(session);
      await bump(session, conversationId);
      clock.now += 1_000;
    }
    await settleLine(session);
    // Only what was used in the last 10 s, about ten conversations' worth.
    expect(sizes().cached).toBeLessThanOrEqual(12);
    await session.close(context);
  });

  it("never changes the outcome of a commit when the clock throws", async () => {
    const clock = { now: 1_000, fail: false };
    const storage = new ControlledStorage();
    const session = new SessionImpl(
      storage,
      () => {
        if (clock.fail) throw new Error("clock");
        return clock.now;
      },
      () => 0,
    );
    const conversationId = await createConversation(session);
    clock.fail = true;
    await bump(session, conversationId, 42);
    clock.fail = false;
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 42 });
    await session.close(context);
  });
});
