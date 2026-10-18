import { defineDoc, defineDocFamily, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
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

const migratedEveryHistoricalValueStep1 = Effect.fn("migratedEveryHistoricalValueStep1")(
  function* () {
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
    return { runPromise, Family, migrations, V3, session, conversationId, entries };
  },
);

const migratedEveryHistoricalValue = Effect.fn("migratedEveryHistoricalValue")(function* () {
  const { runPromise, Family, migrations, V3, session, conversationId, entries } =
    yield* migratedEveryHistoricalValueStep1();
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
