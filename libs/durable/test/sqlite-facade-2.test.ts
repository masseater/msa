import contextModule from "@msa/chord/context";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ids from "../src/ids.ts";
import sqlite from "../src/storage/sqlite/index.ts";
import node from "../src/storage/sqlite/node.ts";
import types from "../src/types.ts";
import type typesModule from "../src/types.types.ts";
import effectSupport from "./effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { openNodeSqliteDatabase } = node;
const { SqliteStorage } = sqlite;
const { idFromNumber } = ids;
const { ROOT_CONVERSATION_ID } = types;

const { awaited } = effectSupport;

const queuesDatabaseCalls = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(database.exec("CREATE TABLE barrier_probe (value INTEGER)"));
  let outside!: Promise<void>;
  const transaction = database.transaction((handle) =>
    runPromise(
      Effect.gen(function* () {
        outside = database.run("INSERT INTO barrier_probe (value) VALUES (?)", 2);
        yield* awaited(handle.run("INSERT INTO barrier_probe (value) VALUES (?)", 1));
        yield* awaited(Promise.resolve());
        throw new Error("roll back");
      }),
    ),
  );
  yield* awaited(expect(transaction).rejects.toThrow("roll back"));
  yield* awaited(outside);
  expect(yield* awaited(database.all("SELECT value FROM barrier_probe"))).toEqual([{ value: 2 }]);
  yield* awaited(database.close());
});

describe("portable SQLite facade settlement", () => {
  it("queues database calls made synchronously by a transaction that started immediately", () =>
    Effect.runPromise(queuesDatabaseCalls));
});

const letsAdmittedMulti = Effect.gen(function* () {
  const storage = yield* awaited(
    SqliteStorage.open(yield* awaited(openNodeSqliteDatabase(":memory:"))),
  );
  const entryId = idFromNumber<typesModule.EntryId>(2);
  yield* awaited(
    storage.commit(
      [
        { type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
        {
          type: "entry",
          value: { conversationId: ROOT_CONVERSATION_ID, id: entryId, kind: "probe" },
        },
      ],
      BACKGROUND_CONTEXT,
    ),
  );
  const scan = storage.scanEntries(
    { conversationId: ROOT_CONVERSATION_ID },
    10,
    undefined,
    BACKGROUND_CONTEXT,
  );
  const entry = storage.entry(ROOT_CONVERSATION_ID, entryId, BACKGROUND_CONTEXT);
  const head = storage.findLatestHeadMarker(ROOT_CONVERSATION_ID, undefined, BACKGROUND_CONTEXT);
  const closed = storage.close(BACKGROUND_CONTEXT);
  expect(storage.close(BACKGROUND_CONTEXT)).toBe(closed);
  expect((yield* awaited(scan)).items.map((item) => item.id)).toEqual([entryId]);
  expect((yield* awaited(entry))?.entry.kind).toBe("probe");
  expect(yield* awaited(head)).toBeUndefined();
  yield* awaited(closed);
  yield* awaited(
    expect(
      storage.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID },
        10,
        undefined,
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("SqliteStorage is closed"),
  );
});

describe("portable SQLite facade settlement", () => {
  it("lets admitted multi-query reads finish before storage closes", () =>
    Effect.runPromise(letsAdmittedMulti));
});
