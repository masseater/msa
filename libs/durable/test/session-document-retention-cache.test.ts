import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { SessionImpl, setDefaultDocumentRetention } from "../src/session/session.ts";
import {
  settleLine,
  type Counter,
  CounterDoc,
  bump,
  open,
  defaultForRun,
} from "./session-document-retention-support.ts";
import { awaited, ControlledStorage, context, createConversation, eventually } from "./support.ts";

const Failing = defineDoc<Counter>({
  kind: "test.retention.failing",
  version: 1,
  scope: "session",
  initial: () => ({ count: 0 }),
  checkpointWhen: () => {
    throw new Error("checkpoint failed");
  },
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
  expect(session.documentCacheSizes).toMatchObject({ cached: 0, idle: 0, attached: 0 });
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
