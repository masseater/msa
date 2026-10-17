import { defineDoc, defineDocFamily, type EntryId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

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

async function migratedRewindableHistory() {
  const { V1, Family, migrations, V3 } = rewindableMigrationDocs();
  const { session, storage } = openTestSession();
  const conversationId = await createConversation(session);
  const entries: { firstEntry?: EntryId; secondEntry?: EntryId; thirdEntry?: EntryId } = {};
  await session.commit(async (tx) => {
    entries.firstEntry = (await tx.appendEntry(conversationId, { kind: "first" })).id;
    (await tx.doc(V1, conversationId)).count = 1;
    (await tx.doc(Family, conversationId, "member", "seed")).count = 1;
  }, context);
  await session.commit(async (tx) => {
    entries.secondEntry = (await tx.appendEntry(conversationId, { kind: "second" })).id;
    (await tx.doc(V1, conversationId)).count = 2;
  }, context);
  await session.unloadDocuments();
  const commits = storage.commits.length;
  expect(await session.snapshot(V3, conversationId, context)).toEqual({ count: 2, version: 3 });
  expect(migrations).toEqual([1]);
  expect(storage.commits).toHaveLength(commits);
  return { Family, migrations, V3, session, storage, conversationId, entries };
}

async function migratedEveryHistoricalValue() {
  const { Family, migrations, V3, session, storage, conversationId, entries } =
    await migratedRewindableHistory();

  await session.commit(async (tx) => {
    entries.thirdEntry = (await tx.appendEntry(conversationId, { kind: "third" })).id;
    await tx.doc(V3, conversationId);
  }, context);
  expect(storage.commits.at(-1)!).toContainEqual(
    expect.objectContaining({
      type: "document.change",
      content: expect.objectContaining({ kind: "base", version: 3 }),
    }),
  );

  expect(await session.snapshotAsOf(V3, conversationId, entries.firstEntry!, context)).toEqual({
    count: 1,
    version: 3,
  });
  expect(await session.snapshotAsOf(V3, conversationId, entries.secondEntry!, context)).toEqual({
    count: 2,
    version: 3,
  });
  expect(await session.snapshotAsOf(V3, conversationId, entries.thirdEntry!, context)).toEqual({
    count: 2,
    version: 3,
  });
  expect(migrations).toEqual([1, 1, 1]);
  expect(
    await session.snapshotAsOf(Family, conversationId, "member", entries.firstEntry!, context),
  ).toEqual({
    seed: "seed",
    count: 1,
  });

  const childId = await session.commit(
    async (tx) =>
      (
        await tx.forkConversation(conversationId, entries.secondEntry!, {
          ownership: { kind: "ownerless" },
        })
      ).id,
    context,
  );
  return { Family, V3, session, entries, childId };
}

describe("Session historical document snapshots", () => {
  it("migrates current and historical rewindable values independently and follows fork ancestry", async () => {
    const { Family, V3, session, entries, childId } = await migratedEveryHistoricalValue();
    expect(await session.snapshotAsOf(V3, childId, entries.firstEntry!, context)).toEqual({
      count: 1,
      version: 3,
    });
    expect(await session.snapshotAsOf(V3, childId, entries.secondEntry!, context)).toEqual({
      count: 2,
      version: 3,
    });
    expect(
      await session.snapshotAsOf(Family, childId, "member", entries.firstEntry!, context),
    ).toEqual({
      seed: "seed",
      count: 1,
    });
    await expect(session.snapshotAsOf(V3, childId, entries.thirdEntry!, context)).rejects.toThrow(
      `Entry ${entries.thirdEntry} is not visible`,
    );
  });
});

describe("Session historical document snapshots", () => {
  it("selects the incarnation alive at the entry commit across retirement and recreation", async () => {
    const Doc = defineDoc<{ value: string }>({
      kind: "history.incarnation",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ value: "initial" }),
    });
    const { session } = openTestSession();
    const conversationId = await createConversation(session);
    const beforeCreation = await session.commit(
      async (tx) => (await tx.appendEntry(conversationId, { kind: "before" })).id,
      context,
    );
    let createdAt!: EntryId;
    let retiredAt!: EntryId;
    let recreatedAt!: EntryId;
    await session.commit(async (tx) => {
      createdAt = (await tx.appendEntry(conversationId, { kind: "create" })).id;
      (await tx.doc(Doc, conversationId)).value = "old";
    }, context);
    await session.commit(async (tx) => {
      retiredAt = (await tx.appendEntry(conversationId, { kind: "retire" })).id;
      await tx.retireDoc(Doc, conversationId);
    }, context);
    await session.commit(async (tx) => {
      recreatedAt = (await tx.appendEntry(conversationId, { kind: "recreate" })).id;
      (await tx.doc(Doc, conversationId)).value = "new";
    }, context);

    expect(
      await session.snapshotAsOf(Doc, conversationId, beforeCreation, context),
    ).toBeUndefined();
    expect(await session.snapshotAsOf(Doc, conversationId, createdAt, context)).toEqual({
      value: "old",
    });
    expect(await session.snapshotAsOf(Doc, conversationId, retiredAt, context)).toBeUndefined();
    expect(await session.snapshotAsOf(Doc, conversationId, recreatedAt, context)).toEqual({
      value: "new",
    });
    await session.close(context);
    await expect(session.snapshotAsOf(Doc, conversationId, recreatedAt, context)).rejects.toThrow(
      "closed",
    );
  });
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

describe("Session tracker cache across definition versions", () => {
  it("migrates a document cached by an older token without unloading", async () => {
    const { session, storage } = openTestSession();
    await session.commit((tx) => tx.doc(V1Doc), context);
    expect(await session.snapshot(V1Doc, context)).toEqual({ name: "first" });

    // Reloaded extension code accesses the still-cached document with a newer token.
    expect(await session.snapshot(V2Doc, context)).toEqual({ names: ["first"] });
    await session.commit(async (tx) => {
      (await tx.doc(V2Doc)).names.push("second");
    }, context);
    const write = documentWrites(storage.commits.at(-1)!)[0]!;
    expect(write).toMatchObject({
      type: "document.change",
      content: { version: 2, kind: "base", value: { names: ["first", "second"] } },
    });
    await expect(session.snapshot(V1Doc, context)).rejects.toThrow("newer version 2");
  });

  it("sends observers of an older shape a root replacement after a newer token writes", async () => {
    const { session } = openTestSession();
    await session.commit((tx) => tx.doc(V1Doc), context);
    const state = (await session.documentState(V1Doc, context))!;
    const watch = (await session.watchDoc(V1Doc, context))!;
    const frames: (readonly unknown[])[] = [];
    const delivered = new Promise<void>((resolve) => {
      watch.start((_value, ops) => {
        frames.push(ops);
        resolve();

        return Promise.resolve();
      });
    });
    await session.commit(async (tx) => {
      (await tx.doc(V2Doc)).names.push("second");
    }, context);
    await delivered;
    expect(state.value).toEqual({ names: ["first", "second"] });
    expect(watch.value).toEqual({ names: ["first", "second"] });
    expect(frames).toEqual([[["r", { names: ["first", "second"] }]]]);
    state.dispose();
    await watch.stop();
  });
});

describe("Session tracker cache across definition versions", () => {
  it("serves an older token from Storage after a newer token migrated only in memory", async () => {
    const { session } = openTestSession();
    await session.commit((tx) => tx.doc(V1Doc), context);
    await session.unloadDocuments();
    expect(await session.snapshot(V2Doc, context)).toEqual({ names: ["first"] });
    expect(await session.snapshot(V1Doc, context)).toEqual({ name: "first" });
    await session.commit(async (tx) => {
      (await tx.doc(V1Doc)).name = "renamed";
    }, context);
    expect(await session.snapshot(V2Doc, context)).toEqual({ names: ["renamed"] });
  });
});
