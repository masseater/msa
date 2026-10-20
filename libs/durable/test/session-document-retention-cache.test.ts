import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import clockModule from "../src/clock.ts";
import sessionState from "../src/session/session-state.ts";
import SessionImpl from "../src/session/session.ts";
import sessionDocumentRetentionSupport from "./session-document-retention-support.ts";
import type sessionDocumentRetentionSupportTypes from "./session-document-retention-support.types.ts";
import support from "./support.ts";

const { defineDoc } = durable;

const { setDefaultDocumentRetention } = sessionState;
const { currentTimeMillis } = clockModule;

const { CounterDoc, bump, defaultForRun, open, settleLine } = sessionDocumentRetentionSupport;
const { ControlledStorage, awaited, context, createConversation, eventually } = support;

const Failing = defineDoc<sessionDocumentRetentionSupportTypes.Counter>({
  checkpointWhen: () => {
    throw new Error("checkpoint failed");
  },
  initial: () => ({ count: 0 }),
  kind: "test.retention.failing",
  scope: "session",
  version: 1,
});

const evictsCommitSettlement = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, clock, sizes } = open(10_000);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  yield* awaited(session.commit((tx) => tx.doc(Failing).then(() => undefined), context));
  yield* settleLine(session);
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(Failing))).count++;
              clock.now += 1_000_000;
            }),
          ),
        context,
      ),
    ).rejects.toThrow("checkpoint failed"),
  );
  expect(sizes().cached).toBe(0);
  yield* awaited(session.close(context));
});

const evictsPromptlyOnce = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const retention = { ms: 600_000 };
  const storage = new ControlledStorage();
  const clock = { now: 1_000 };
  const session = new SessionImpl(
    storage,
    () => clock.now,
    () => retention.ms,
  );
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  retention.ms = 0;
  clock.now += 2_000;
  yield* awaited(session.snapshot(CounterDoc, conversationId, context));
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return session.documentCacheSizes.cached === 0;
      }),
    ),
  );
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("evicts after a commit whose settlement fails", () =>
    Effect.runPromise(evictsCommitSettlement));

  it("evicts promptly once the retention is shortened", () =>
    Effect.runPromise(evictsPromptlyOnce));
});

const doesNotKeep = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, sizes } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  const state = (yield* awaited(session.documentState(CounterDoc, conversationId, context)))!;
  yield* awaited(session.commit((tx) => tx.retireDoc(CounterDoc, conversationId), context));
  expect(state.value).toBeNull();
  yield* bump(session, conversationId, 5);
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return sizes().cached === 0;
      }),
    ),
  );
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 5,
  });
  state.dispose();
  yield* awaited(session.close(context));
});

const leavesNoPin = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return session.documentCacheSizes.cached === 0;
      }),
    ),
  );
  const gate = storage.holdFindDocument();
  const attaching = session.documentState(CounterDoc, conversationId, context);
  yield* awaited(gate.entered);
  const closing = session.close(context);
  gate.release();
  yield* awaited(expect(attaching).rejects.toThrow());
  yield* awaited(closing);
  expect(session.documentCacheSizes).toMatchObject({ attached: 0, cached: 0, idle: 0 });
});

describe("document cache retention", () => {
  it("does not keep a replacement cached for an observer of the retired incarnation", () =>
    Effect.runPromise(doesNotKeep));

  it("leaves no pin behind when an observer's load loses a race with close", () =>
    Effect.runPromise(leavesNoPin));
});

const evictsTimerWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  const session = new SessionImpl(storage, currentTimeMillis, () => 20);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  const state = (yield* awaited(session.documentState(CounterDoc, conversationId, context)))!;
  state.dispose();
  state.dispose();
  const until = currentTimeMillis() + 2_000;
  const drained = (): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        if (session.documentCacheSizes.cached === 0 || currentTimeMillis() >= until) return;
        yield* Effect.sleep(10);
        yield* awaited(drained());
      }),
    );
  yield* awaited(drained());
  expect(session.documentCacheSizes.cached).toBe(0);
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("evicts on its timer without a commit, and tolerates a detach called twice", () =>
    Effect.runPromise(evictsTimerWithout));
});

const migratesDocumentAgain = Effect.gen(function* () {
  const V1 = defineDoc<{ count: number }>({
    initial: () => ({ count: 1 }),
    kind: "test.retention.migrating",
    scope: "session",
    version: 1,
  });
  let migrations = 0;
  const V2 = defineDoc<{ count: number; migrated: boolean }>({
    initial: () => ({ count: 0, migrated: true }),
    kind: "test.retention.migrating",
    migrate: (value) => {
      migrations++;
      return { count: (value as { count: number }).count, migrated: true };
    },
    scope: "session",
    version: 2,
  });
  const { session } = open(0);
  yield* awaited(session.commit((tx) => tx.doc(V1).then(() => undefined), context));
  yield* settleLine(session);
  expect(yield* awaited(session.snapshot(V2, context))).toEqual({ count: 1, migrated: true });
  yield* settleLine(session);
  expect(yield* awaited(session.snapshot(V2, context))).toEqual({ count: 1, migrated: true });
  expect(migrations).toBe(2);
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("migrates a document again after its eviction", () =>
    Effect.runPromise(migratesDocumentAgain));
});

const treatsRetentionNot = Effect.gen(function* () {
  setDefaultDocumentRetention(600_000);
  onTestFinished(() => setDefaultDocumentRetention(defaultForRun));
  for (const retention of [Number.NaN, -5, "soon" as unknown as number]) {
    const { session, clock, sizes } = open(retention);
    const conversationId = yield* awaited(createConversation(session));
    yield* bump(session, conversationId);
    clock.now += 60_000;
    yield* awaited(session.commit(() => Promise.resolve(), context));
    yield* settleLine(session);
    expect(sizes().cached).toBe(1);
    yield* awaited(session.close(context));
  }
  const { session, clock, sizes } = open(Number.POSITIVE_INFINITY);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  clock.now += 1e15;
  yield* awaited(session.commit(() => Promise.resolve(), context));
  yield* settleLine(session);
  expect(sizes().cached).toBe(1);
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("treats a retention that is not a number of milliseconds as the default, and Infinity as never", () =>
    Effect.runPromise(treatsRetentionNot));
});
