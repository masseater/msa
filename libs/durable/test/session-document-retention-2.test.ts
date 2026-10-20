import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import SessionImpl from "../src/session/session.ts";
import ControlledStorage from "./controlled-storage.ts";
import effectSupport from "./effect-support.ts";
import sessionDocumentRetentionSupport from "./session-document-retention-support.ts";
import type sessionDocumentRetentionSupportTypes from "./session-document-retention-support.types.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineDoc, defineDocFamily } = durable;

const { awaited } = effectSupport;
const { CounterDoc, bump, open, settleLine } = sessionDocumentRetentionSupport;
const { context, createConversation } = sessionSupport;
const { eventually } = taskSupport;

const RewindableDoc = defineDoc<sessionDocumentRetentionSupportTypes.Counter>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ count: 0 }),
  kind: "test.retention.rewindable",
  scope: "conversation",
  version: 1,
});

const EventDoc = defineDocFamily<{ seq: number }, number>({
  family: true,
  fork: "initial",
  history: "latest",
  initial: (seq) => ({ seq }),
  kind: "test.retention.event",
  scope: "conversation",
  version: 1,
});

const keepsHistoryForksStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = open(0);
  const conversationId = yield* awaited(createConversation(session));
  const first = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(RewindableDoc, conversationId))).count = 1;
            return (yield* awaited(tx.appendEntry(conversationId, { data: null, kind: "note" })))
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
            return (yield* awaited(tx.appendEntry(conversationId, { data: null, kind: "note" })))
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
  return { conversationId, first, runPromise, session };
});

const keepsHistoryForks = Effect.gen(function* () {
  const { runPromise, session, conversationId, first } = yield* keepsHistoryForksStep1;
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
  const clock = { fail: false, now: 1_000 };
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
