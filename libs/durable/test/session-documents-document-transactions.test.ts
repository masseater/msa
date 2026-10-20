import type { JsonValue } from "@msa/chord";
import { type JsonObject, type TaskId, defineDoc } from "@msa/durable";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import effectSupport from "./effect-support.ts";
import sessionDocumentsSupport from "./session-documents-support.ts";
import type sessionDocumentsSupportTypes from "./session-documents-support.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { CounterDoc, LiveDoc, setupLive } = sessionDocumentsSupport;
const { context, createConversation, openTestSession } = sessionSupport;

const RewindableLiveDoc = defineDoc<sessionDocumentsSupportTypes.Live>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ items: [], nested: { count: 0 }, other: { label: "x" } }),
  kind: "test.live",
  scope: "conversation",
  version: 1,
});

const LiveDocV2 = defineDoc<sessionDocumentsSupportTypes.Live>({
  fork: "initial",
  history: "latest",
  initial: () => ({ items: [], nested: { count: 0 }, other: { label: "x" } }),
  kind: "test.live",
  scope: "conversation",
  version: 2,
});

const doesNotInitialize = Effect.gen(function* () {
  const { session, storage } = openTestSession();
  let initialized = 0;
  const LateDoc = defineDoc<sessionDocumentsSupportTypes.Counter>({
    initial: () => {
      initialized++;
      return { count: 0 };
    },
    kind: "test.late",
    scope: "session",
    version: 1,
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
    initial: () => ({ at: DateTime.toDateUtc(DateTime.nowUnsafe()) }) as unknown as JsonObject,
    kind: "test.date",
    scope: "session",
    version: 1,
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

const rollsBackPreparedStep1 = Effect.gen(function* () {
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
                abortRequested: false,
                background: false,
                conversationId,
                id: idFromNumber<TaskId<JsonValue>>(999),
                input: null,
                kind: "missing",
                state: { checkpoint: { phase: "start" }, status: "pending" },
                version: 1,
              });
            }),
          ),
        context,
      ),
    ).rejects.toThrow("Task 999 does not exist"),
  );
  expect(storage.commits.length).toBe(commits);
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(live);
  return { conversationId, counter, runPromise, session };
});

const rollsBackPrepared = Effect.gen(function* () {
  const { runPromise, session, conversationId, counter } = yield* rollsBackPreparedStep1;
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
