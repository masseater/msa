import type { Draft, JsonValue } from "@msa/chord";
import { defineDoc, type JsonObject, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import { awaited } from "./effect-support.ts";
import {
  setupLive,
  LiveDoc,
  type Live,
  CounterDoc,
  type Counter,
} from "./session-documents-support.ts";
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

const RewindableLiveDoc = defineDoc<Live>({
  kind: "test.live",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ items: [], nested: { count: 0 }, other: { label: "x" } }),
});

const LiveDocV2 = defineDoc<Live>({
  kind: "test.live",
  version: 2,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [], nested: { count: 0 }, other: { label: "x" } }),
});

const doesNotInitialize = Effect.gen(function* () {
  const { session, storage } = openTestSession();
  let initialized = 0;
  const LateDoc = defineDoc<Counter>({
    kind: "test.late",
    version: 1,
    scope: "session",
    initial: () => {
      initialized++;
      return { count: 0 };
    },
  });
  const gate = storage.holdFindDocument();
  const mints = storage.mintCount;
  let pending: Promise<unknown> | undefined;
  const commit = session.commit((tx) => {
    pending = tx.doc(LateDoc);
  }, context);
  yield* awaited(gate.entered);
  gate.release();
  yield* awaited(expect(commit).rejects.toThrow("pending Tx operations"));
  yield* awaited(expect(pending).rejects.toThrow("Transaction has settled"));
  expect(initialized).toBe(0);
  expect(storage.mintCount).toBe(mints);
});

const rejectsCallbackError = Effect.gen(function* () {
  const { session, storage, conversationId } = yield* setupLive();
  yield* awaited(session.unloadDocuments());
  const gate = storage.holdFindDocument();
  let pending: Promise<unknown> | undefined;
  const commit = session.commit((tx) => {
    pending = tx.doc(LiveDoc, conversationId);
    throw new Error("callback failed");
  }, context);
  yield* awaited(gate.entered);
  gate.release();
  yield* awaited(expect(commit).rejects.toThrow("callback failed"));
  yield* awaited(expect(pending).rejects.toThrow("Transaction has settled"));
});

describe("Session document transactions", () => {
  it("does not initialize or mint for an absent acquisition that finishes after settlement", () =>
    Effect.runPromise(doesNotInitialize));

  it("rejects with the callback error when it fails with a pending acquisition", () =>
    Effect.runPromise(rejectsCallbackError));
});

const rejectsTxUse = Effect.gen(function* () {
  const { session, conversationId } = yield* setupLive();
  let captured: Parameters<Parameters<typeof session.commitWith>[0]>[0] | undefined;
  yield* awaited(
    session.commitWith((tx) => {
      captured = tx;
    }, context),
  );
  yield* awaited(
    expect(captured!.doc(LiveDoc, conversationId)).rejects.toThrow("Transaction has settled"),
  );
  yield* awaited(
    expect(captured!.conversation(conversationId)).rejects.toThrow("Transaction has settled"),
  );
  expect(() => captured!.setTask({} as never)).toThrow("Transaction has settled");
});

const rejectsTokensSemantics = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, conversationId } = yield* setupLive();
  yield* awaited(
    expect(session.snapshot(RewindableLiveDoc, conversationId, context)).rejects.toThrow(
      "does not match the supplied definition semantics",
    ),
  );
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.asVoid(Effect.suspend(() => awaited(tx.doc(RewindableLiveDoc, conversationId)))),
          ),
        context,
      ),
    ).rejects.toThrow("does not match the supplied definition semantics"),
  );
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.asVoid(Effect.suspend(() => awaited(tx.doc(LiveDocV2, conversationId)))),
          ),
        context,
      ),
    ).rejects.toThrow("requires migration from version 1"),
  );
});

describe("Session document transactions", () => {
  it("rejects Tx use after the callback settles", () => Effect.runPromise(rejectsTxUse));

  it("rejects tokens whose semantics or version disagree with the stored incarnation", () =>
    Effect.runPromise(rejectsTokensSemantics));
});

const rejectsNonJson = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const DateDoc = defineDoc<JsonObject>({
    kind: "test.date",
    version: 1,
    scope: "session",
    initial: () => ({ at: new Date() }) as unknown as JsonObject,
  });
  yield* awaited(
    expect(
      session.commit(
        (tx) => runPromise(Effect.asVoid(Effect.suspend(() => awaited(tx.doc(DateDoc))))),
        context,
      ),
    ).rejects.toThrow("strict JSON"),
  );
  const commits = storage.commits.length;
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const live = yield* awaited(tx.doc(LiveDoc, conversationId));
              live.items.push(undefined as unknown as string);
            }),
          ),
        context,
      ),
    ).rejects.toThrow("strict JSON"),
  );
  expect(storage.commits.length).toBe(commits);
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();
});

describe("Session document transactions", () => {
  it("rejects non-JSON initializer values and draft placements before Storage admission", () =>
    Effect.runPromise(rejectsNonJson));
});

const rollsBackPrepared = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, conversationId } = yield* setupLive();
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(CounterDoc))).count = 1;
          }),
        ),
      context,
    ),
  );
  const live = yield* awaited(session.snapshot(LiveDoc, conversationId, context));
  const counter = yield* awaited(session.snapshot(CounterDoc, context));
  const commits = storage.commits.length;
  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "lost";
              (yield* awaited(tx.doc(CounterDoc))).count = 2;
              tx.setTask({
                id: idFromNumber<TaskId<JsonValue>>(999),
                conversationId,
                kind: "missing",
                version: 1,
                input: null,
                background: false,
                abortRequested: false,
                state: { status: "pending", checkpoint: { phase: "start" } },
              });
            }),
          ),
        context,
      ),
    ).rejects.toThrow("Task 999 does not exist"),
  );
  expect(storage.commits.length).toBe(commits);
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(live);
  expect(yield* awaited(session.snapshot(CounterDoc, context))).toBe(counter);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "next";
            (yield* awaited(tx.doc(CounterDoc))).count = 3;
          }),
        ),
      context,
    ),
  );
  expect((yield* awaited(session.snapshot(CounterDoc, context)))!.count).toBe(3);
});

describe("Session document transactions", () => {
  it("rolls back prepared documents when batch assembly fails", () =>
    Effect.runPromise(rollsBackPrepared));
});

const failsSessionStorage = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const before = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  const published = publications.length;
  storage.failNextCommit(new Error("disk vanished"));
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "uncertain";
            }),
          ),
        context,
      ),
    ).rejects.toThrow("disk vanished"),
  );
  yield* flush;
  expect(publications.length).toBe(published);
  expect(before.message).toBeUndefined();
  yield* awaited(
    expect(session.snapshot(LiveDoc, conversationId, context)).rejects.toMatchObject({
      name: "SessionFailed",
    }),
  );
  yield* awaited(
    expect(session.commit(() => undefined, context)).rejects.toMatchObject({
      name: "SessionFailed",
    }),
  );
  yield* awaited(session.close(context));
});

const keepsPreviousRevision = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, conversationId } = yield* setupLive();
  const before = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  const copy = structuredClone(before);
  const gate = storage.holdCommits();
  const commit = session.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          const live = yield* awaited(tx.doc(LiveDoc, conversationId));
          live.items.push("c");
          live.nested.count = 9;
        }),
      ),
    context,
  );
  yield* awaited(gate.entered);
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(before);
  expect(before).toEqual(copy);
  gate.release();
  yield* awaited(commit);
  const after = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  expect(after.items).toEqual(["a", "b", "c"]);
  expect(before).toEqual(copy);
});

describe("Session document transactions", () => {
  it("fails the Session after a Storage failure and publishes nothing", () =>
    Effect.runPromise(failsSessionStorage));

  it("keeps the previous revision unchanged through Storage settlement", () =>
    Effect.runPromise(keepsPreviousRevision));
});

const retiresDocumentsCreates = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
  let replacement: Draft<Live> | undefined;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.message = "final";
            yield* awaited(tx.retireDoc(LiveDoc, conversationId));
            replacement = yield* awaited(tx.doc(LiveDoc, conversationId));
            expect(replacement).not.toBe(live);
            replacement.message = "new";
          }),
        ),
      context,
    ),
  );
  const writes = storage.commits.at(-1)!;
  expect(writes).toHaveLength(3);
  expect(writes).toContainEqual(expect.objectContaining({ type: "document.change", id: oldId }));
  expect(writes).toContainEqual({ type: "document.retire", id: oldId });
  expect(writes).toContainEqual(
    expect.objectContaining({
      type: "document.create",
      record: expect.objectContaining({ kind: "test.live" }),
    }),
  );
  yield* flush;
  const publication = publications.at(-1)!;
  const [retired, created] = documentChanges(publication);
  expect(retired).toMatchObject({ record: { id: oldId }, value: null, ops: [] });
  expect(retired!.record.retiredAt).toBe(publication.seq);
  expect(created!.record.id).not.toBe(oldId);
  expect(created!.record.createdAt).toBe(publication.seq);
  expect(created).toMatchObject({ value: { message: "new", items: [] }, ops: [] });
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(created!.value);

  yield* awaited(session.commit((tx) => tx.retireDoc(LiveDoc, conversationId), context));
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();
  yield* awaited(session.unloadDocuments());
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();
  const commits = storage.commits.length;
  yield* awaited(session.commit((tx) => tx.retireDoc(LiveDoc, conversationId), context));
  expect(storage.commits.length).toBe(commits);
});

describe("Session document transactions", () => {
  it("retires documents and creates a new incarnation at the same address", () =>
    Effect.runPromise(retiresDocumentsCreates));
});
