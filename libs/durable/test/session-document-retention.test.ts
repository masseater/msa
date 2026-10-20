import type { Context } from "@msa/chord";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import SessionImpl from "../src/session/session.ts";
import SessionCounterDoc from "./session-document-retention-cases.ts";
import sessionDocumentRetentionSupport from "./session-document-retention-support.ts";
import support from "./support.ts";

const { CounterDoc, bump, open, settleLine } = sessionDocumentRetentionSupport;
const { awaited, context, createConversation, currentTimeMillis, deferred, eventually } = support;

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
  const writes: durableTypes.StorageWrite[][] = [];
  const commit = storage.commit.bind(storage);
  storage.commit = (batch: readonly durableTypes.StorageWrite[], commitContext: Context) => {
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
