import { DatabaseSync, type StatementSync } from "node:sqlite";

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

const { SqliteStorage } = sqlite;
const { NodeSqliteDatabase, openNodeSqliteDatabase } = node;
const { ROOT_CONVERSATION_ID } = types;
const { idFromNumber } = ids;

const { awaited } = effectSupport;

class PrepareCountingDatabaseSync extends DatabaseSync {
  private readonly prepareCounts = new Map<string, number>();

  override prepare(sql: string): StatementSync {
    this.prepareCounts.set(sql, (this.prepareCounts.get(sql) ?? 0) + 1);
    return super.prepare(sql);
  }

  repeatedPrepares(): string[] {
    return [...this.prepareCounts].filter(([, count]) => count > 1).map(([sql]) => sql);
  }
}

const preparedStatementsStorage = Effect.fn("preparedStatementsStorage")(function* () {
  const connection = new PrepareCountingDatabaseSync(":memory:");
  const storage = yield* awaited(SqliteStorage.open(new NodeSqliteDatabase(connection)));
  yield* awaited(
    storage.commit(
      [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
      BACKGROUND_CONTEXT,
    ),
  );
  return { connection, storage };
});

const preparesEachStorageStep = () =>
  Effect.gen(function* () {
    const { connection, storage } = yield* preparedStatementsStorage();
    yield* awaited(
      storage.commit(
        Array.from({ length: 100 }, (_, index) => ({
          type: "entry" as const,
          value: {
            conversationId: ROOT_CONVERSATION_ID,
            id: idFromNumber<typesModule.EntryId>(index + 2),
            kind: "cached",
          },
        })),
        BACKGROUND_CONTEXT,
      ),
    );
    yield* awaited(
      storage.commit(
        [
          {
            type: "entry",
            value: {
              conversationId: ROOT_CONVERSATION_ID,
              id: idFromNumber<typesModule.EntryId>(102),
              kind: "cached-again",
            },
          },
        ],
        BACKGROUND_CONTEXT,
      ),
    );
    expect(
      (yield* awaited(storage.entry(idFromNumber<typesModule.EntryId>(2), BACKGROUND_CONTEXT)))
        ?.entry.kind,
    ).toBe("cached");
    expect(
      (yield* awaited(storage.entry(idFromNumber<typesModule.EntryId>(102), BACKGROUND_CONTEXT)))
        ?.entry.kind,
    ).toBe("cached-again");
    yield* awaited(
      expect(
        storage.commit(
          [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
          BACKGROUND_CONTEXT,
        ),
      ).rejects.toThrow("ID 1 already belongs to conversation"),
    );
    return { connection, storage };
  });

const preparesEachStorage = Effect.gen(function* () {
  const { connection, storage } = yield* preparesEachStorageStep();
  expect(
    (yield* awaited(storage.entry(idFromNumber<typesModule.EntryId>(2), BACKGROUND_CONTEXT)))?.entry
      .kind,
  ).toBe("cached");
  expect(connection.repeatedPrepares()).toEqual([]);
  yield* awaited(storage.close(BACKGROUND_CONTEXT));
});

describe("portable SQLite facade settlement", () => {
  it("prepares each storage statement once per connection and reuses it across transactions", () =>
    Effect.runPromise(preparesEachStorage));
});

const commitsWorkDone = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(
    database.transaction((transaction) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(transaction.exec("CREATE TABLE async_probe (value INTEGER)"));
          yield* awaited(transaction.run("INSERT INTO async_probe (value) VALUES (?)", 1));
        }),
      ),
    ),
  );
  expect(yield* awaited(database.get("SELECT value FROM async_probe"))).toEqual({ value: 1 });
  yield* awaited(database.close());
  yield* awaited(database.close());
});

const serializesConcurrentTransactions = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(database.exec("CREATE TABLE transaction_queue (value INTEGER)"));
  const { promise: firstStarted, resolve: markFirstStarted } = Promise.withResolvers<void>();
  const { promise: firstGate, resolve: releaseFirst } = Promise.withResolvers<void>();
  const first = database.transaction((transaction) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(transaction.exec("INSERT INTO transaction_queue (value) VALUES (1)"));
        markFirstStarted();
        yield* awaited(firstGate);
      }),
    ),
  );
  yield* awaited(firstStarted);

  let secondStarted = false;
  const second = database.transaction((transaction) =>
    runPromise(
      Effect.gen(function* () {
        secondStarted = true;
        yield* awaited(transaction.exec("INSERT INTO transaction_queue (value) VALUES (2)"));
      }),
    ),
  );
  yield* awaited(Promise.resolve());
  expect(secondStarted).toBe(false);

  releaseFirst();
  yield* awaited(Promise.all([first, second]));
  expect(
    yield* awaited(database.all("SELECT value FROM transaction_queue ORDER BY value")),
  ).toEqual([{ value: 1 }, { value: 2 }]);
  yield* awaited(database.close());
});

describe("portable SQLite facade settlement", () => {
  it("commits work done through the transaction handle and closes idempotently", () =>
    Effect.runPromise(commitsWorkDone));

  it("serializes concurrent transactions", () =>
    Effect.runPromise(serializesConcurrentTransactions));
});

const runsOperationsCall = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(database.exec("CREATE TABLE call_order (value INTEGER)"));
  const transaction = database.transaction((handle) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(handle.run("INSERT INTO call_order (value) VALUES (?)", 1));
        yield* awaited(Promise.resolve());
        throw new Error("roll back");
      }),
    ),
  );
  const beforeWrite = database.all("SELECT value FROM call_order ORDER BY value");
  const write = database.run("INSERT INTO call_order (value) VALUES (?)", 2);
  const afterWrite = database.all("SELECT value FROM call_order ORDER BY value");
  yield* awaited(expect(transaction).rejects.toThrow("roll back"));
  yield* awaited(write);
  expect(yield* awaited(beforeWrite)).toEqual([]);
  expect(yield* awaited(afterWrite)).toEqual([{ value: 2 }]);

  const storage = yield* awaited(SqliteStorage.open(database));
  const commit = storage.commit(
    [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
    BACKGROUND_CONTEXT,
  );
  const read = storage.conversation(ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT);
  yield* awaited(commit);
  expect(yield* awaited(read)).toEqual({ id: ROOT_CONVERSATION_ID });
  yield* awaited(storage.close(BACKGROUND_CONTEXT));
});

describe("portable SQLite facade settlement", () => {
  it("runs operations in call order whether they start immediately or wait", () =>
    Effect.runPromise(runsOperationsCall));
});

const queuesOrdinaryOperations = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(database.exec("CREATE TABLE operation_queue (value INTEGER)"));
  const { promise: transactionStarted, resolve: markTransactionStarted } =
    Promise.withResolvers<void>();
  const { promise: transactionGate, resolve: releaseTransaction } = Promise.withResolvers<void>();
  const pending = database.transaction((transaction) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(transaction.exec("INSERT INTO operation_queue (value) VALUES (1)"));
        markTransactionStarted();
        yield* awaited(transactionGate);
      }),
    ),
  );
  yield* awaited(transactionStarted);

  let writeSettled = false;
  const write = database.exec("INSERT INTO operation_queue (value) VALUES (2)").finally(() => {
    writeSettled = true;
  });
  let readSettled = false;
  const read = database.all("SELECT value FROM operation_queue ORDER BY value").finally(() => {
    readSettled = true;
  });
  yield* awaited(Promise.resolve());
  expect(writeSettled).toBe(false);
  expect(readSettled).toBe(false);

  releaseTransaction();
  yield* awaited(pending);
  yield* awaited(write);
  yield* awaited(expect(read).resolves.toEqual([{ value: 1 }, { value: 2 }]));
  yield* awaited(database.close());
});

describe("portable SQLite facade settlement", () => {
  it("queues ordinary operations behind an active transaction", () =>
    Effect.runPromise(queuesOrdinaryOperations));
});
