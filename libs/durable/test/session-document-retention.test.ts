import type { Context } from "@msa/chord";
import { defineDoc, defineDocFamily, type StorageWrite } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { SessionImpl } from "../src/session/session.ts";
import { awaited } from "./effect-support.ts";
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

const evictsUnattachedDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, clock, sizes } = open(60_000);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId, 3);
  expect(sizes().cached).toBeGreaterThan(0);
  clock.now += 59_000;
  yield* bump(session, conversationId, 0);
  yield* settleLine(session);
  expect(sizes().cached).toBeGreaterThan(0);
  clock.now += 61_000;
  yield* awaited(session.commit(() => Promise.resolve(), context));
  yield* awaited(
    session.commit(
      (tx) => runPromise(Effect.asVoid(Effect.suspend(() => awaited(tx.doc(SessionCounterDoc))))),
      context,
    ),
  );
  yield* settleLine(session);
  const reads = storage.documentReadCount;
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 3,
  });
  expect(storage.documentReadCount).toBeGreaterThan(reads);
  yield* awaited(session.close(context));
});

const evictsRetention0 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, sizes } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return sizes().cached === 0;
      }),
    ),
  );
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 1,
  });
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("evicts an unattached document once its retention passed, and loads it again with the same value", () =>
    Effect.runPromise(evictsUnattachedDocument));

  it("evicts with retention 0 right after use, on the line", () =>
    Effect.runPromise(evictsRetention0));
});

const neverEvictsDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, clock, sizes } = open(1_000);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  const watch = (yield* awaited(session.watchDoc(CounterDoc, conversationId, context)))!;
  const state = (yield* awaited(session.documentState(CounterDoc, conversationId, context)))!;
  const seen: number[] = [];
  watch.start((value) => {
    seen.push(value?.count ?? -1);

    return Promise.resolve();
  });
  clock.now += 1_000_000;
  yield* bump(session, conversationId);
  yield* settleLine(session);
  expect(state.value?.count).toBe(2);
  yield* eventually(() => seen.includes(2));
  const reads = storage.documentReadCount;
  clock.now += 1_000_000;
  yield* awaited(
    session.commit(
      (tx) => runPromise(Effect.asVoid(Effect.suspend(() => awaited(tx.doc(SessionCounterDoc))))),
      context,
    ),
  );
  yield* settleLine(session);
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 2,
  });
  expect(storage.documentReadCount).toBe(reads);
  yield* awaited(watch.stop());
  clock.now += 1_000_000;
  yield* bump(session, conversationId);
  yield* settleLine(session);
  expect(state.value?.count).toBe(3);
  state.dispose();
  clock.now += 1_000_000;
  yield* awaited(session.commit(() => Promise.resolve(), context));
  yield* awaited(
    session.commit(
      (tx) => runPromise(Effect.asVoid(Effect.suspend(() => awaited(tx.doc(SessionCounterDoc))))),
      context,
    ),
  );
  yield* settleLine(session);
  expect(sizes().cached).toBe(1);
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("never evicts a document a watch or a document state observes, and evicts it once the last detaches", () =>
    Effect.runPromise(neverEvictsDocument));
});

const neverTakesTracker = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, clock } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  yield* bump(session, conversationId);
  const inside = deferred();
  const release = deferred();
  const commit = session.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          const draft = yield* awaited(tx.doc(CounterDoc, conversationId));
          inside.resolve();
          yield* awaited(release.promise);
          draft.count += 10;
        }),
      ),
    context,
  );
  yield* awaited(inside.promise);
  clock.now += 1_000_000;
  release.resolve();
  yield* awaited(commit);
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 11,
  });
  yield* bump(session, conversationId);
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 12,
  });
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("never takes a tracker from a transaction that holds it", () =>
    Effect.runPromise(neverTakesTracker));
});

const writesReloadContinue = Effect.gen(function* () {
  const { session, storage } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  const writes: StorageWrite[][] = [];
  const commit = storage.commit.bind(storage);
  storage.commit = (batch: readonly StorageWrite[], commitContext: Context) => {
    writes.push([...batch]);
    return commit(batch, commitContext);
  };
  for (const _ of Array.from({ length: 5 })) {
    yield* bump(session, conversationId);
    yield* settleLine(session);
  }
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 5,
  });
  const creations = writes
    .flat()
    .filter(
      (write) =>
        write.type === "document.create" && write.record.kind === CounterDoc.definition.kind,
    );
  expect(creations).toHaveLength(1);
  yield* awaited(session.close(context));
  const reopened = new SessionImpl(storage.reopen(), currentTimeMillis, () => 0);
  expect(yield* awaited(reopened.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 5,
  });
  yield* awaited(reopened.close(context));
});

describe("document cache retention", () => {
  it("writes after a reload continue the stored deltas and bases", () =>
    Effect.runPromise(writesReloadContinue));
});

const keepsHistoryForks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  const first = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(RewindableDoc, conversationId))).count = 1;
            return (yield* awaited(tx.appendEntry(conversationId, { kind: "note", data: null })))
              .id;
          }),
        ),
      context,
    ),
  );
  yield* settleLine(session);
  const second = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(RewindableDoc, conversationId))).count = 2;
            return (yield* awaited(tx.appendEntry(conversationId, { kind: "note", data: null })))
              .id;
          }),
        ),
      context,
    ),
  );
  yield* settleLine(session);
  expect(
    yield* awaited(session.snapshotAsOf(RewindableDoc, conversationId, first, context)),
  ).toEqual({
    count: 1,
  });
  expect(
    yield* awaited(session.snapshotAsOf(RewindableDoc, conversationId, second, context)),
  ).toEqual({
    count: 2,
  });
  const fork = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(
              tx.forkConversation(conversationId, first, {
                ownership: { kind: "ownerless" },
              }),
            )).id;
          }),
        ),
      context,
    ),
  );
  yield* settleLine(session);
  expect(yield* awaited(session.snapshot(RewindableDoc, fork, context))).toEqual({
    count: 1,
  });
  expect(yield* awaited(session.snapshot(RewindableDoc, conversationId, context))).toEqual({
    count: 2,
  });
  yield* awaited(session.close(context));
});

const boundsThirdParty = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, sizes } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  for (const seq of Array.from({ length: 200 }, (_, i) => i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.asVoid(
              Effect.suspend(() => awaited(tx.doc(EventDoc, conversationId, String(seq), seq))),
            ),
          ),
        context,
      ),
    );
  }
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return sizes().cached === 0;
      }),
    ),
  );
  expect(yield* awaited(session.snapshot(EventDoc, conversationId, "123", context))).toEqual({
    seq: 123,
  });
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("keeps history and forks of rewindable documents after eviction", () =>
    Effect.runPromise(keepsHistoryForks));

  it("bounds a third-party family with a member per event", () =>
    Effect.runPromise(boundsThirdParty));
});

const keepsCacheLong = Effect.gen(function* () {
  const { session, clock, sizes } = open(10_000);
  for (const _ of Array.from({ length: 300 })) {
    const conversationId = yield* awaited(createConversation(session));
    yield* bump(session, conversationId);
    clock.now += 1_000;
  }
  yield* settleLine(session);
  expect(sizes().cached).toBeLessThanOrEqual(12);
  yield* awaited(session.close(context));
});

const neverChangesOutcome = Effect.gen(function* () {
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
  const conversationId = yield* awaited(createConversation(session));
  clock.fail = true;
  yield* bump(session, conversationId, 42);
  clock.fail = false;
  expect(yield* awaited(session.snapshot(CounterDoc, conversationId, context))).toEqual({
    count: 42,
  });
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("keeps the cache of a long-lived Session bounded across many conversations", () =>
    Effect.runPromise(keepsCacheLong));

  it("never changes the outcome of a commit when the clock throws", () =>
    Effect.runPromise(neverChangesOutcome));
});
