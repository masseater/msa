import { defineDoc, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  V1Doc,
  V2Doc,
} from "./session-checkpoints-migrations-historical-document-snapshots-cases.ts";
import { documentWrites } from "./session-checkpoints-migrations-support.ts";
import { context, createConversation, openTestSession } from "./session-support.ts";

const selectsIncarnationAlive = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    kind: "history.incarnation",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "initial" }),
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
  let createdAt!: EntryId;
  let retiredAt!: EntryId;
  let recreatedAt!: EntryId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            createdAt = (yield* awaited(tx.appendEntry(conversationId, { kind: "create" }))).id;
            (yield* awaited(tx.doc(Doc, conversationId))).value = "old";
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
            retiredAt = (yield* awaited(tx.appendEntry(conversationId, { kind: "retire" }))).id;
            yield* awaited(tx.retireDoc(Doc, conversationId));
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
            recreatedAt = (yield* awaited(tx.appendEntry(conversationId, { kind: "recreate" }))).id;
            (yield* awaited(tx.doc(Doc, conversationId))).value = "new";
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
    type: "document.change",
    content: { version: 2, kind: "base", value: { names: ["first", "second"] } },
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
