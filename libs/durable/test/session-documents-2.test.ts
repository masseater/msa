import type { Draft } from "@msa/chord";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  setupLive,
  LiveDoc,
  liveInitCount,
  type Live,
  MemberDoc,
  seeds,
  CounterDoc,
} from "./session-documents-support.ts";
import { context, createConversation, flush, openTestSession } from "./session-support.ts";

const revokesEscapedDrafts = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, conversationId } = yield* setupLive();
  let escaped: Draft<Live> | undefined;
  let items: Draft<string[]> | undefined;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            escaped = yield* awaited(tx.doc(LiveDoc, conversationId));
            items = escaped.items;
            escaped.message = "inside";
          }),
        ),
      context,
    ),
  );
  expect(() => escaped!.message).toThrow();
  expect(() => {
    escaped!.message = "outside";
  }).toThrow();
  expect(() => items!.length).toThrow();
  expect(() => items!.push("outside")).toThrow();
  expect((yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!.message).toBe(
    "inside",
  );

  const returned = yield* awaited(session.commit((tx) => tx.doc(LiveDoc, conversationId), context));
  expect(() => returned.message).toThrow();
});

const abortsEveryChange = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, conversationId } = yield* setupLive();
  const before = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  const commits = storage.commits.length;
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const live = yield* awaited(tx.doc(LiveDoc, conversationId));
              const counter = yield* awaited(tx.doc(CounterDoc));
              live.message = "lost";
              counter.count = 5;
              throw new Error("callback failed");
            }),
          ),
        context,
      ),
    ).rejects.toThrow("callback failed"),
  );
  expect(storage.commits.length).toBe(commits);
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(before);
  expect(yield* awaited(session.snapshot(CounterDoc, context))).toBeUndefined();
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "kept";
          }),
        ),
      context,
    ),
  );
  expect((yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!.message).toBe(
    "kept",
  );
});

describe("Session document transactions", () => {
  it("revokes escaped drafts when the callback settles", () =>
    Effect.runPromise(revokesEscapedDrafts));

  it("aborts every change when the callback fails", () => Effect.runPromise(abortsEveryChange));
});

const memoizesConcurrentDuplicate = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const initCount = liveInitCount;
  const mints = storage.mintCount;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const [first, second] = yield* awaited(
              Promise.all([tx.doc(LiveDoc, conversationId), tx.doc(LiveDoc, conversationId)]),
            );
            expect(first).toBe(second);
            expect(yield* awaited(tx.doc(LiveDoc, conversationId))).toBe(first);
            first.message = "once";
          }),
        ),
      context,
    ),
  );
  expect(liveInitCount).toBe(initCount + 1);
  expect(storage.mintCount).toBe(mints + 1);
  expect(storage.commits.at(-1)!.filter((write) => write.type === "document.create")).toHaveLength(
    1,
  );
});

const usesFirstFamily = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  seeds.length = 0;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const first = yield* awaited(tx.doc(MemberDoc, "k", "first"));
            const second = yield* awaited(tx.doc(MemberDoc, "k", "second"));
            expect(second).toBe(first);
            first.hits++;
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(MemberDoc, "k", "third"))).hits++;
            (yield* awaited(tx.doc(MemberDoc, "other", "fourth"))).hits++;
          }),
        ),
      context,
    ),
  );
  expect(seeds).toEqual(["first", "fourth"]);
  expect(yield* awaited(session.snapshot(MemberDoc, "k", context))).toEqual({
    seed: "first",
    hits: 2,
  });
  expect(yield* awaited(session.snapshot(MemberDoc, "other", context))).toEqual({
    seed: "fourth",
    hits: 1,
  });
});

describe("Session document transactions", () => {
  it("memoizes concurrent duplicate acquisition and initializes once", () =>
    Effect.runPromise(memoizesConcurrentDuplicate));

  it("uses the first family seed and ignores seeds for existing members", () =>
    Effect.runPromise(usesFirstFamily));
});

const rejectsCallbackSucceeds = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, conversationId } = yield* setupLive();
  yield* awaited(session.unloadDocuments());
  const gate = storage.holdFindDocument();
  const commits = storage.commits.length;
  let pending: Promise<unknown> | undefined;
  const commit = session.commit((tx) => {
    pending = tx.doc(LiveDoc, conversationId);
  }, context);
  yield* awaited(gate.entered);
  let settled = false;
  void commit.catch(() => {
    settled = true;
  });
  yield* flush;
  expect(settled).toBe(false);
  gate.release();
  yield* awaited(expect(commit).rejects.toThrow("pending Tx operations"));
  yield* awaited(expect(pending).rejects.toThrow("Transaction has settled"));
  expect(storage.commits.length).toBe(commits);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "after";
          }),
        ),
      context,
    ),
  );
  expect((yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!.message).toBe(
    "after",
  );
});

describe("Session document transactions", () => {
  it("rejects a callback that succeeds with a pending acquisition and drains it", () =>
    Effect.runPromise(rejectsCallbackSucceeds));
});
