import type { Draft } from "@msa/chord";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionDocumentsSupport from "./session-documents-support.ts";
import type sessionDocumentsSupportTypes from "./session-documents-support.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { CounterDoc, LiveDoc, MemberDoc, setupLive } = sessionDocumentsSupport;
const { context, createConversation, documentChanges, flush, openTestSession } = sessionSupport;

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
    content: {
      kind: "base",
      value: { items: [], message: "hello", nested: { count: 0 } },
      version: 1,
    },
    record: {
      fork: "initial",
      history: "latest",
      kind: "test.live",
      scope: { conversationId, kind: "conversation" },
    },
    type: "document.create",
  });
  const snapshot = yield* awaited(session.snapshot(LiveDoc, conversationId, context));
  expect(snapshot).toEqual({
    items: [],
    message: "hello",
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
            (live as Draft<sessionDocumentsSupportTypes.Live> & { copy?: { label: string } }).copy =
              value;
            value.label = "mutated";
          }),
        ),
      context,
    ),
  );
  const snapshot = (yield* awaited(
    session.snapshot(LiveDoc, conversationId, context),
  )) as sessionDocumentsSupportTypes.Live & {
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
  expect(writes[0]).toMatchObject({ content: { kind: "delta" }, type: "document.change" });
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
