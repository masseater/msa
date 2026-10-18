import { defineDoc, type HarnessSettings } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import { SessionImpl, setDefaultDocumentRetention } from "../src/session/session.ts";
import { chatSetup, openChat } from "./chat-support.ts";
import {
  settleLine,
  type Counter,
  CounterDoc,
  bump,
  open,
  defaultForRun,
} from "./session-document-retention-support.ts";
import { ControlledStorage, context, createConversation } from "./session-support.ts";
import { eventually } from "./task-support.ts";

/** A session document whose checkpoint predicate throws, so the commit that changes it fails while it settles. */
const Failing = defineDoc<Counter>({
  kind: "test.retention.failing",
  version: 1,
  scope: "session",
  initial: () => ({ count: 0 }),
  checkpointWhen: () => {
    throw new Error("checkpoint failed");
  },
});

/** A conversation document any Harness test can read. */
const TestDoc = defineDoc<Counter>({
  kind: "test.retention.harness",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ count: 0 }),
});

describe("document cache retention", () => {
  it("evicts after a commit whose settlement fails", async () => {
    const { session, clock, sizes } = open(10_000);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    // Created first: the predicate runs only for changes to an existing document.
    await session.commit((tx) => tx.doc(Failing).then(() => undefined), context);
    await settleLine(session);
    // Retention passes inside a commit whose checkpoint predicate throws while it settles.
    await expect(
      session.commit(async (tx) => {
        (await tx.doc(Failing)).count++;
        clock.now += 1_000_000;
      }, context),
    ).rejects.toThrow("checkpoint failed");
    expect(sizes().cached).toBe(0);
    await session.close(context);
  });

  it("evicts promptly once the retention is shortened", async () => {
    const retention = { ms: 600_000 };
    const storage = new ControlledStorage();
    const clock = { now: 1_000 };
    const session = new SessionImpl(
      storage,
      () => clock.now,
      () => retention.ms,
    );
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    retention.ms = 0;
    clock.now += 2_000;
    // A read, no commit: the sweep pending for ten minutes from now moves up.
    await session.snapshot(CounterDoc, conversationId, context);
    await eventually(async () => {
      await settleLine(session);
      return session.documentCacheSizes.cached === 0;
    });
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("does not keep a replacement cached for an observer of the retired incarnation", async () => {
    const { session, sizes } = open(0);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    const state = (await session.documentState(CounterDoc, conversationId, context))!;
    await session.commit((tx) => tx.retireDoc(CounterDoc, conversationId), context);
    expect(state.value).toBeNull();
    await bump(session, conversationId, 5);
    await eventually(async () => {
      await settleLine(session);
      return sizes().cached === 0;
    });
    expect(await session.snapshot(CounterDoc, conversationId, context)).toEqual({ count: 5 });
    state.dispose();
    await session.close(context);
  });

  it("leaves no pin behind when an observer's load loses a race with close", async () => {
    const { session, storage } = open(0);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    await eventually(async () => {
      await settleLine(session);
      return session.documentCacheSizes.cached === 0;
    });
    const gate = storage.holdFindDocument();
    const attaching = session.documentState(CounterDoc, conversationId, context);
    await gate.entered;
    const closing = session.close(context);
    gate.release();
    await expect(attaching).rejects.toThrow();
    await closing;
    expect(session.documentCacheSizes).toMatchObject({ cached: 0, idle: 0, attached: 0 });
  });
});

describe("document cache retention", () => {
  it("evicts on its timer without a commit, and tolerates a detach called twice", async () => {
    const storage = new ControlledStorage();
    const session = new SessionImpl(storage, Date.now, () => 20);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    const state = (await session.documentState(CounterDoc, conversationId, context))!;
    state.dispose();
    state.dispose();
    const until = Date.now() + 2_000;
    const drained = async (): Promise<void> => {
      if (session.documentCacheSizes.cached === 0 || Date.now() >= until) return;
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      await drained();
    };
    await drained();
    expect(session.documentCacheSizes.cached).toBe(0);
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("migrates a document again after its eviction", async () => {
    const V1 = defineDoc<{ count: number }>({
      kind: "test.retention.migrating",
      version: 1,
      scope: "session",
      initial: () => ({ count: 1 }),
    });
    let migrations = 0;
    const V2 = defineDoc<{ count: number; migrated: boolean }>({
      kind: "test.retention.migrating",
      version: 2,
      scope: "session",
      initial: () => ({ count: 0, migrated: true }),
      migrate: (value) => {
        migrations++;
        return { count: (value as { count: number }).count, migrated: true };
      },
    });
    const { session } = open(0);
    await session.commit((tx) => tx.doc(V1).then(() => undefined), context);
    await settleLine(session);
    expect(await session.snapshot(V2, context)).toEqual({ count: 1, migrated: true });
    await settleLine(session);
    expect(await session.snapshot(V2, context)).toEqual({ count: 1, migrated: true });
    // Not written back, so each cold load migrates again.
    expect(migrations).toBe(2);
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("treats a retention that is not a number of milliseconds as the default, and Infinity as never", async () => {
    // The default as shipped, also in the suite run that forces another.
    setDefaultDocumentRetention(600_000);
    onTestFinished(() => setDefaultDocumentRetention(defaultForRun));
    for await (const retention of [Number.NaN, -5, "soon" as unknown as number]) {
      const { session, clock, sizes } = open(retention);
      const conversationId = await createConversation(session);
      await bump(session, conversationId);
      clock.now += 60_000;
      await session.commit(async () => {}, context);
      await settleLine(session);
      // Not dropped at once, as a retention of 0 would: the ten-minute default holds it.
      expect(sizes().cached).toBe(1);
      await session.close(context);
    }
    const { session, clock, sizes } = open(Number.POSITIVE_INFINITY);
    const conversationId = await createConversation(session);
    await bump(session, conversationId);
    clock.now += 1e15;
    await session.commit(async () => {}, context);
    await settleLine(session);
    expect(sizes().cached).toBe(1);
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("keeps no timer where timers cannot be unreferenced, and evicts on commits", async () => {
    const setTimer = globalThis.setTimeout;
    let timers = 0;
    globalThis.setTimeout = ((callback: () => void, ms?: number) => {
      timers++;
      const timer = setTimer(callback, ms);
      // As in Cloudflare Workers: a plain number, no `unref`.
      return Number(timer as unknown as number) as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      const { session, clock, sizes } = open(1_000);
      const conversationId = await createConversation(session);
      await bump(session, conversationId);
      await bump(session, conversationId);
      // Tried once, then never again.
      expect(timers).toBeLessThanOrEqual(1);
      clock.now += 10_000;
      await session.commit(async () => {}, context);
      await settleLine(session);
      expect(sizes().cached).toBe(0);
      await session.close(context);
    } finally {
      globalThis.setTimeout = setTimer;
    }
  });

  it("follows a Harness settings change at the next use", async () => {
    setDefaultDocumentRetention(600_000);
    onTestFinished(() => setDefaultDocumentRetention(defaultForRun));
    const setup = chatSetup();
    const settings: { -readonly [K in keyof HarnessSettings]: HarnessSettings[K] } = setup.settings;
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    await root.commit(async (tx) => {
      (await tx.doc(TestDoc, root.id)).count++;
    }, context);
    const sizesOf = () => (harness as unknown as SessionImpl).documentCacheSizes;
    expect(sizesOf().cached).toBeGreaterThan(0);
    settings.documentRetentionMs = 0;
    await harness.snapshot(TestDoc, root.id, context);
    await eventually(async () => {
      await (harness as unknown as SessionImpl).readOnLine(async () => {});
      return sizesOf().cached === 0;
    });
    await harness.close(context);
  });
});
