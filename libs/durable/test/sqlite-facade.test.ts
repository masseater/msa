import { DatabaseSync, type StatementSync } from "node:sqlite";

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import { SqliteStorage } from "../src/storage/sqlite/index.ts";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "../src/storage/sqlite/node.ts";
import { type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";

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

async function preparedStatementsStorage() {
  const connection = new PrepareCountingDatabaseSync(":memory:");
  const storage = await SqliteStorage.open(new NodeSqliteDatabase(connection));
  await storage.commit(
    [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
    BACKGROUND_CONTEXT,
  );
  return { connection, storage };
}

describe("portable SQLite facade settlement", () => {
  it("prepares each storage statement once per connection and reuses it across transactions", async () => {
    const { connection, storage } = await preparedStatementsStorage();
    await storage.commit(
      Array.from({ length: 100 }, (_, index) => ({
        type: "entry" as const,
        value: {
          id: idFromNumber<EntryId>(index + 2),
          conversationId: ROOT_CONVERSATION_ID,
          kind: "cached",
        },
      })),
      BACKGROUND_CONTEXT,
    );
    await storage.commit(
      [
        {
          type: "entry",
          value: {
            id: idFromNumber<EntryId>(102),
            conversationId: ROOT_CONVERSATION_ID,
            kind: "cached-again",
          },
        },
      ],
      BACKGROUND_CONTEXT,
    );
    expect((await storage.entry(idFromNumber<EntryId>(2), BACKGROUND_CONTEXT))?.entry.kind).toBe(
      "cached",
    );
    expect((await storage.entry(idFromNumber<EntryId>(102), BACKGROUND_CONTEXT))?.entry.kind).toBe(
      "cached-again",
    );
    await expect(
      storage.commit(
        [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("ID 1 already belongs to conversation");
    expect((await storage.entry(idFromNumber<EntryId>(2), BACKGROUND_CONTEXT))?.entry.kind).toBe(
      "cached",
    );
    expect(connection.repeatedPrepares()).toEqual([]);
    await storage.close(BACKGROUND_CONTEXT);
  });
});

describe("portable SQLite facade settlement", () => {
  it("commits work done through the transaction handle and closes idempotently", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.transaction(async (transaction) => {
      await transaction.exec("CREATE TABLE async_probe (value INTEGER)");
      await transaction.run("INSERT INTO async_probe (value) VALUES (?)", 1);
    });
    expect(await database.get("SELECT value FROM async_probe")).toEqual({ value: 1 });
    await database.close();
    await database.close();
  });

  it("serializes concurrent transactions", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.exec("CREATE TABLE transaction_queue (value INTEGER)");
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = database.transaction(async (transaction) => {
      await transaction.exec("INSERT INTO transaction_queue (value) VALUES (1)");
      markFirstStarted();
      await firstGate;
    });
    await firstStarted;

    let secondStarted = false;
    const second = database.transaction(async (transaction) => {
      secondStarted = true;
      await transaction.exec("INSERT INTO transaction_queue (value) VALUES (2)");
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    releaseFirst();
    await Promise.all([first, second]);
    expect(await database.all("SELECT value FROM transaction_queue ORDER BY value")).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
    await database.close();
  });
});

describe("portable SQLite facade settlement", () => {
  it("runs operations in call order whether they start immediately or wait", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.exec("CREATE TABLE call_order (value INTEGER)");
    // Operations called during a transaction must neither see its uncommitted rows nor join its rollback.
    const transaction = database.transaction(async (handle) => {
      await handle.run("INSERT INTO call_order (value) VALUES (?)", 1);
      await Promise.resolve();
      throw new Error("roll back");
    });
    const beforeWrite = database.all("SELECT value FROM call_order ORDER BY value");
    const write = database.run("INSERT INTO call_order (value) VALUES (?)", 2);
    const afterWrite = database.all("SELECT value FROM call_order ORDER BY value");
    await expect(transaction).rejects.toThrow("roll back");
    await write;
    expect(await beforeWrite).toEqual([]);
    expect(await afterWrite).toEqual([{ value: 2 }]);

    const storage = await SqliteStorage.open(database);
    const commit = storage.commit(
      [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
      BACKGROUND_CONTEXT,
    );
    const read = storage.conversation(ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT);
    await commit;
    expect(await read).toEqual({ id: ROOT_CONVERSATION_ID });
    await storage.close(BACKGROUND_CONTEXT);
  });
});

describe("portable SQLite facade settlement", () => {
  it("queues ordinary operations behind an active transaction", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.exec("CREATE TABLE operation_queue (value INTEGER)");
    let markTransactionStarted!: () => void;
    const transactionStarted = new Promise<void>((resolve) => {
      markTransactionStarted = resolve;
    });
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const pending = database.transaction(async (transaction) => {
      await transaction.exec("INSERT INTO operation_queue (value) VALUES (1)");
      markTransactionStarted();
      await transactionGate;
    });
    await transactionStarted;

    let writeSettled = false;
    const write = database.exec("INSERT INTO operation_queue (value) VALUES (2)").finally(() => {
      writeSettled = true;
    });
    let readSettled = false;
    const read = database.all("SELECT value FROM operation_queue ORDER BY value").finally(() => {
      readSettled = true;
    });
    await Promise.resolve();
    expect(writeSettled).toBe(false);
    expect(readSettled).toBe(false);

    releaseTransaction();
    await pending;
    await write;
    await expect(read).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    await database.close();
  });
});

describe("portable SQLite facade settlement", () => {
  it("queues database calls made synchronously by a transaction that started immediately", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.exec("CREATE TABLE barrier_probe (value INTEGER)");
    let outside!: Promise<void>;
    const transaction = database.transaction(async (handle) => {
      // Misuse: this call must wait for the transaction instead of joining it.
      outside = database.run("INSERT INTO barrier_probe (value) VALUES (?)", 2);
      await handle.run("INSERT INTO barrier_probe (value) VALUES (?)", 1);
      await Promise.resolve();
      throw new Error("roll back");
    });
    await expect(transaction).rejects.toThrow("roll back");
    await outside;
    expect(await database.all("SELECT value FROM barrier_probe")).toEqual([{ value: 2 }]);
    await database.close();
  });
});

describe("portable SQLite facade settlement", () => {
  it("lets admitted multi-query reads finish before storage closes", async () => {
    const storage = await SqliteStorage.open(await openNodeSqliteDatabase(":memory:"));
    const entryId = idFromNumber<EntryId>(2);
    await storage.commit(
      [
        { type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
        {
          type: "entry",
          value: { id: entryId, conversationId: ROOT_CONVERSATION_ID, kind: "probe" },
        },
      ],
      BACKGROUND_CONTEXT,
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
    // A repeated close settles only when the database is closed.
    expect(storage.close(BACKGROUND_CONTEXT)).toBe(closed);
    expect((await scan).items.map((item) => item.id)).toEqual([entryId]);
    expect((await entry)?.entry.kind).toBe("probe");
    expect(await head).toBeUndefined();
    await closed;
    await expect(
      storage.scanEntries(
        { conversationId: ROOT_CONVERSATION_ID },
        10,
        undefined,
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("SqliteStorage is closed");
  });
});
