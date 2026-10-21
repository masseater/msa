import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCases from "./session-checkpoints-migrations-historical-document-snapshots-cases.ts";
import documentWrites from "./session-checkpoints-migrations-support.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const { V1Doc, V2Doc } = sessionCheckpointsMigrationsHistoricalDocumentSnapshotsCases;
const { context, createConversation, openTestSession } = sessionSupport;

const selectsIncarnationAliveStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "initial" }),
    kind: "history.incarnation",
    scope: "conversation",
    version: 1,
  });
  const { session } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const beforeCreation = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.appendEntry(conversationId, { kind: "before" }))).id;
          }),
        ),
      context,
    ),
  );
  const createdAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const createdAtInner = (yield* awaited(
              tx.appendEntry(conversationId, { kind: "create" }),
            )).id;
            (yield* awaited(tx.doc(Doc, conversationId))).value = "old";
            return createdAtInner;
          }),
        ),
      context,
    ),
  );
  return { Doc, beforeCreation, conversationId, createdAt, runPromise, session };
});

const selectsIncarnationAliveStep2 = Effect.gen(function* () {
  const { runPromise, Doc, session, conversationId, beforeCreation, createdAt } =
    yield* selectsIncarnationAliveStep1;
  const retiredAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const retiredAtInner = (yield* awaited(
              tx.appendEntry(conversationId, { kind: "retire" }),
            )).id;
            yield* awaited(tx.retireDoc(Doc, conversationId));
            return retiredAtInner;
          }),
        ),
      context,
    ),
  );
  const recreatedAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const recreatedAtInner = (yield* awaited(
              tx.appendEntry(conversationId, { kind: "recreate" }),
            )).id;
            (yield* awaited(tx.doc(Doc, conversationId))).value = "new";
            return recreatedAtInner;
          }),
        ),
      context,
    ),
  );

  expect(
    yield* awaited(session.snapshotAsOf(Doc, conversationId, beforeCreation, context)),
  ).toBeUndefined();
  expect(yield* awaited(session.snapshotAsOf(Doc, conversationId, createdAt, context))).toEqual({
    value: "old",
  });
  expect(
    yield* awaited(session.snapshotAsOf(Doc, conversationId, retiredAt, context)),
  ).toBeUndefined();
  expect(yield* awaited(session.snapshotAsOf(Doc, conversationId, recreatedAt, context))).toEqual({
    value: "new",
  });
  return { Doc, conversationId, recreatedAt, session };
});

const selectsIncarnationAlive = Effect.gen(function* () {
  const { Doc, session, conversationId, recreatedAt } = yield* selectsIncarnationAliveStep2;
  yield* awaited(session.close(context));
  yield* awaited(
    expect(session.snapshotAsOf(Doc, conversationId, recreatedAt, context)).rejects.toThrow(
      "closed",
    ),
  );
});

describe("Session historical document snapshots", () => {
  it("selects the incarnation alive at the entry commit across retirement and recreation", () =>
    Effect.runPromise(selectsIncarnationAlive));
});

const migratesDocumentCached = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(V1Doc), context));
  expect(yield* awaited(session.snapshot(V1Doc, context))).toEqual({ name: "first" });

  expect(yield* awaited(session.snapshot(V2Doc, context))).toEqual({ names: ["first"] });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(V2Doc))).names.push("second");
          }),
        ),
      context,
    ),
  );
  const write = documentWrites(storage.commits.at(-1)!)[0]!;
  expect(write).toMatchObject({
    content: { kind: "base", value: { names: ["first", "second"] }, version: 2 },
    type: "document.change",
  });
  yield* awaited(expect(session.snapshot(V1Doc, context)).rejects.toThrow("newer version 2"));
});

const sendsObserversOlder = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(V1Doc), context));
  const state = (yield* awaited(session.documentState(V1Doc, context)))!;
  const watch = (yield* awaited(session.watchDoc(V1Doc, context)))!;
  const frames: (readonly unknown[])[] = [];
  const { promise: delivered, resolve } = Promise.withResolvers<void>();
  watch.start((_value, ops) => {
    frames.push(ops);
    resolve();

    return Promise.resolve();
  });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(V2Doc))).names.push("second");
          }),
        ),
      context,
    ),
  );
  yield* awaited(delivered);
  expect(state.value).toEqual({ names: ["first", "second"] });
  expect(watch.value).toEqual({ names: ["first", "second"] });
  expect(frames).toEqual([[["r", { names: ["first", "second"] }]]]);
  state.dispose();
  yield* awaited(watch.stop());
});

describe("Session tracker cache across definition versions", () => {
  it("migrates a document cached by an older token without unloading", () =>
    Effect.runPromise(migratesDocumentCached));

  it("sends observers of an older shape a root replacement after a newer token writes", () =>
    Effect.runPromise(sendsObserversOlder));
});

const servesOlderToken = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(V1Doc), context));
  yield* awaited(session.unloadDocuments());
  expect(yield* awaited(session.snapshot(V2Doc, context))).toEqual({ names: ["first"] });
  expect(yield* awaited(session.snapshot(V1Doc, context))).toEqual({ name: "first" });
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(V1Doc))).name = "renamed";
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(V2Doc, context))).toEqual({ names: ["renamed"] });
});

describe("Session tracker cache across definition versions", () => {
  it("serves an older token from Storage after a newer token migrated only in memory", () =>
    Effect.runPromise(servesOlderToken));
});
