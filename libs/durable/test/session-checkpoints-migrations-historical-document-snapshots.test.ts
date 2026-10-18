import { defineDoc, defineDocFamily, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { documentWrites } from "./session-checkpoints-migrations-support.ts";
import { context, createConversation, openTestSession } from "./session-support.ts";

function rewindableMigrationDocs() {
  const V1 = defineDoc<{ count: number }>({
    kind: "history.migration",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ count: 0 }),
  });
  const Family = defineDocFamily<{ seed: string; count: number }, string>({
    kind: "history.family",
    version: 1,
    family: true,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: (seed) => ({ seed, count: 0 }),
  });
  const migrations: number[] = [];
  const V3 = defineDoc<{ count: number; version: number }>({
    kind: "history.migration",
    version: 3,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ count: 0, version: 3 }),
    migrate: (value, fromVersion) => {
      migrations.push(fromVersion);
      return { count: value["count"] as number, version: 3 };
    },
  });
  return { V1, Family, migrations, V3 };
}

const migratedRewindableHistory = Effect.fn("migratedRewindableHistory")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { V1, Family, migrations, V3 } = rewindableMigrationDocs();
  const { session, storage } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const entries: { firstEntry?: EntryId; secondEntry?: EntryId; thirdEntry?: EntryId } = {};
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            entries.firstEntry = (yield* awaited(
              tx.appendEntry(conversationId, { kind: "first" }),
            )).id;
            (yield* awaited(tx.doc(V1, conversationId))).count = 1;
            (yield* awaited(tx.doc(Family, conversationId, "member", "seed"))).count = 1;
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
            entries.secondEntry = (yield* awaited(
              tx.appendEntry(conversationId, { kind: "second" }),
            )).id;
            (yield* awaited(tx.doc(V1, conversationId))).count = 2;
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.unloadDocuments());
  const commits = storage.commits.length;
  expect(yield* awaited(session.snapshot(V3, conversationId, context))).toEqual({
    count: 2,
    version: 3,
  });
  expect(migrations).toEqual([1]);
  expect(storage.commits).toHaveLength(commits);
  return { Family, migrations, V3, session, storage, conversationId, entries };
});

const migratedEveryHistoricalValue = Effect.fn("migratedEveryHistoricalValue")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Family, migrations, V3, session, storage, conversationId, entries } =
    yield* migratedRewindableHistory();

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            entries.thirdEntry = (yield* awaited(
              tx.appendEntry(conversationId, { kind: "third" }),
            )).id;
            yield* awaited(tx.doc(V3, conversationId));
          }),
        ),
      context,
    ),
  );
  expect(storage.commits.at(-1)!).toContainEqual(
    expect.objectContaining({
      type: "document.change",
      content: expect.objectContaining({ kind: "base", version: 3 }),
    }),
  );

  expect(
    yield* awaited(session.snapshotAsOf(V3, conversationId, entries.firstEntry!, context)),
  ).toEqual({
    count: 1,
    version: 3,
  });
  expect(
    yield* awaited(session.snapshotAsOf(V3, conversationId, entries.secondEntry!, context)),
  ).toEqual({
    count: 2,
    version: 3,
  });
  expect(
    yield* awaited(session.snapshotAsOf(V3, conversationId, entries.thirdEntry!, context)),
  ).toEqual({
    count: 2,
    version: 3,
  });
  expect(migrations).toEqual([1, 1, 1]);
  expect(
    yield* awaited(
      session.snapshotAsOf(Family, conversationId, "member", entries.firstEntry!, context),
    ),
  ).toEqual({
    seed: "seed",
    count: 1,
  });

  const childId = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(
              tx.forkConversation(conversationId, entries.secondEntry!, {
                ownership: { kind: "ownerless" },
              }),
            )).id;
          }),
        ),
      context,
    ),
  );
  return { Family, V3, session, entries, childId };
});

const migratesCurrentHistorical = Effect.gen(function* () {
  const { Family, V3, session, entries, childId } = yield* migratedEveryHistoricalValue();
  expect(yield* awaited(session.snapshotAsOf(V3, childId, entries.firstEntry!, context))).toEqual({
    count: 1,
    version: 3,
  });
  expect(yield* awaited(session.snapshotAsOf(V3, childId, entries.secondEntry!, context))).toEqual({
    count: 2,
    version: 3,
  });
  expect(
    yield* awaited(session.snapshotAsOf(Family, childId, "member", entries.firstEntry!, context)),
  ).toEqual({
    seed: "seed",
    count: 1,
  });
  yield* awaited(
    expect(session.snapshotAsOf(V3, childId, entries.thirdEntry!, context)).rejects.toThrow(
      `Entry ${entries.thirdEntry} is not visible`,
    ),
  );
});

describe("Session historical document snapshots", () => {
  it("migrates current and historical rewindable values independently and follows fork ancestry", () =>
    Effect.runPromise(migratesCurrentHistorical));
});

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

type V1 = { name: string };

type V2 = { names: string[] };

const V1Doc = defineDoc<V1>({
  kind: "cache.versioned",
  version: 1,
  scope: "session",
  initial: () => ({ name: "first" }),
});

const V2Doc = defineDoc<V2>({
  kind: "cache.versioned",
  version: 2,
  scope: "session",
  initial: () => ({ names: [] }),
  migrate: (value) => ({ names: [value["name"] as string] }),
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
  const delivered = new Promise<void>((resolve) => {
    watch.start((_value, ops) => {
      frames.push(ops);
      resolve();

      return Promise.resolve();
    });
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
