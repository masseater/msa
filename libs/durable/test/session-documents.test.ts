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
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

const createsInitialBase = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.message = "hello";
          }),
        ),
      context,
    ),
  );
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
  const snapshot = yield* awaited(session.snapshot(LiveDoc, conversationId, context));
  expect(snapshot).toEqual({
    message: "hello",
    items: [],
    nested: { count: 0 },
    other: { label: "x" },
  });
  yield* flush;
  const publication = publications.at(-1)!;
  const published = documentChanges(publication)[0]!;
  expect(published.record.createdAt).toBe(publication.seq);
  expect(published.value).toBe(snapshot);
  expect(published.conversationId).toBe(conversationId);
  const create = storage.admittedCommits.at(-1)!.find((write) => write.type === "document.create")!;
  expect(create.content.value).toBe(published.value);
});

describe("Session document transactions", () => {
  it("creates an initial base on first access and adopts it after Storage success", () =>
    Effect.runPromise(createsInitialBase));
});

const neverCreatesSnapshot = Effect.gen(function* () {
  const { session, storage } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const before = storage.commits.length;
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();
  expect(yield* awaited(session.snapshot(CounterDoc, context))).toBeUndefined();
  expect(yield* awaited(session.snapshot(MemberDoc, "k", context))).toBeUndefined();
  expect(storage.commits.length).toBe(before);
  expect(storage.mintCount).toBe(1);
});

const returnsSharedImmutable = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, conversationId } = yield* setupLive();
  const first = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(first);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.nested.count = 1;
          }),
        ),
      context,
    ),
  );
  const second = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  expect(second).not.toBe(first);
  expect(first.nested.count).toBe(0);
  expect(second.nested.count).toBe(1);
  expect(second.items).toBe(first.items);
  expect(second.other).toBe(first.other);
});

describe("Session document transactions", () => {
  it("never creates on snapshot and returns undefined when absent", () =>
    Effect.runPromise(neverCreatesSnapshot));

  it("returns shared immutable snapshots and keeps prior revisions stable", () =>
    Effect.runPromise(returnsSharedImmutable));
});

const adoptsPointerSwap = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.other = { label: "y" };
            live.items.push("c");
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const snapshot = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
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
  expect(set![2]).toBe(snapshot.other);
});

const copiesAssignedValues = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, conversationId } = yield* setupLive();
  const value = { label: "shared" };
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.other = value;
            (live as Draft<Live> & { copy?: { label: string } }).copy = value;
            value.label = "mutated";
          }),
        ),
      context,
    ),
  );
  const snapshot = (yield* awaited(session.snapshot(LiveDoc, conversationId, context))) as Live & {
    copy: { label: string };
  };
  expect(snapshot.other).toEqual({ label: "shared" });
  expect(snapshot.copy).toEqual({ label: "shared" });
  expect(snapshot.copy).not.toBe(snapshot.other);
  expect(snapshot.other).not.toBe(value);
});

describe("Session document transactions", () => {
  it("adopts by pointer swap and shares operation payloads with the published revision", () =>
    Effect.runPromise(adoptsPointerSwap));

  it("copies assigned values per placement", () => Effect.runPromise(copiesAssignedValues));
});

const suppressesWritesPublications = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const commits = storage.commits.length;
  const published = publications.length;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.nested.count = 0;
            live.items.push("z");
            live.items.pop();
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(storage.commits.length).toBe(commits);
  expect(publications.length).toBe(published);
});

const writesPublishesReplayable = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  const before = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            const first = live.items.shift()!;
            live.items.unshift(first);
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const writes = storage.commits.at(-1)!;
  expect(writes[0]).toMatchObject({ type: "document.change", content: { kind: "delta" } });
  const after = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  expect(after).toEqual(before);
  expect(after).not.toBe(before);
  expect(documentChanges(publications.at(-1)!)[0]!.ops.length).toBeGreaterThan(0);
});

describe("Session document transactions", () => {
  it("suppresses writes and publications for empty batches", () =>
    Effect.runPromise(suppressesWritesPublications));

  it("writes and publishes replayable nonempty structural no-ops", () =>
    Effect.runPromise(writesPublishesReplayable));
});

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
