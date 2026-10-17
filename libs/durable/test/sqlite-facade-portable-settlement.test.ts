import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "../src/storage/sqlite/index.ts";
import { SqliteStorage } from "../src/storage/sqlite/index.ts";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "../src/storage/sqlite/node.ts";
import { type DocumentId, type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";

type SettlementMode = "immediate" | "delay" | "reject";

class ControlledSettlementDatabase implements SqliteDatabase {
  private readonly delegate: NodeSqliteDatabase;
  private mode: SettlementMode = "immediate";
  private pendingSettlement: (() => void) | undefined;

  constructor(delegate: NodeSqliteDatabase) {
    this.delegate = delegate;
  }

  exec(sql: string): Promise<void> {
    return this.delegate.exec(sql);
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.delegate.run(sql, ...params);
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.delegate.get<T>(sql, ...params);
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.delegate.all<T>(sql, ...params);
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    const mode = this.mode;
    this.mode = "immediate";
    if (mode === "immediate") return this.delegate.transaction(callback);
    const settlement = this.delegate.transaction(async (transaction) => {
      const value = await callback(transaction);
      if (mode === "reject") throw new Error("controlled settlement rejection");
      return value;
    });
    return new Promise<T>((resolve, reject) => {
      this.pendingSettlement = () => void settlement.then(resolve, reject);
    });
  }

  close(): Promise<void> {
    return this.delegate.close();
  }

  controlNextSettlement(mode: Exclude<SettlementMode, "immediate">): void {
    if (this.pendingSettlement !== undefined) throw new Error("A settlement is already pending");
    this.mode = mode;
  }

  settle(): void {
    const settle = this.pendingSettlement;
    if (settle === undefined) throw new Error("No settlement is pending");
    this.pendingSettlement = undefined;
    settle();
  }
}

async function expectDelayedCommit(database: ControlledSettlementDatabase, storage: SqliteStorage) {
  database.controlNextSettlement("delay");
  const committing = storage.commit(
    [
      {
        type: "entry",
        value: {
          id: idFromNumber<EntryId>(100),
          conversationId: ROOT_CONVERSATION_ID,
          kind: "settled",
        },
      },
    ],
    BACKGROUND_CONTEXT,
  );
  let committed = false;
  void committing.then(() => {
    committed = true;
  });
  await Promise.resolve();
  expect(committed).toBe(false);
  expect(await storage.mintId<EntryId>()).toBe(2);
  database.settle();
  await expect(committing).resolves.toBe(1);
  expect(await storage.mintId<EntryId>()).toBe(101);
}

async function expectRejectedCommit(
  database: ControlledSettlementDatabase,
  storage: SqliteStorage,
) {
  database.controlNextSettlement("reject");
  const rejected = storage.commit(
    [
      {
        type: "entry",
        value: {
          id: idFromNumber<EntryId>(200),
          conversationId: ROOT_CONVERSATION_ID,
          kind: "rejected",
        },
      },
    ],
    BACKGROUND_CONTEXT,
  );
  expect(await storage.mintId<EntryId>()).toBe(102);
  database.settle();
  await expect(rejected).rejects.toThrow("controlled settlement rejection");
  expect(await storage.mintId<EntryId>()).toBe(103);
  expect(await storage.entry(idFromNumber<EntryId>(200), BACKGROUND_CONTEXT)).toBeUndefined();
  await storage.close(BACKGROUND_CONTEXT);
}

describe("portable SQLite facade settlement", () => {
  it("rejects a transaction handle used after its transaction settles", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.exec("CREATE TABLE stale_probe (value INTEGER)");
    let handle!: SqliteExecutor;
    await database.transaction(async (transaction) => {
      handle = transaction;
      await transaction.run("INSERT INTO stale_probe (value) VALUES (?)", 1);
    });
    const stale = "SQLite transaction handle is no longer active";
    await expect(handle.exec("INSERT INTO stale_probe (value) VALUES (2)")).rejects.toThrow(stale);
    await expect(handle.run("INSERT INTO stale_probe (value) VALUES (?)", 3)).rejects.toThrow(
      stale,
    );
    expect(await database.all("SELECT value FROM stale_probe")).toEqual([{ value: 1 }]);
    await database.close();
  });

  it("does not preserve the callback error when rollback itself fails", async () => {
    const database = await openNodeSqliteDatabase(":memory:");
    await database.exec("CREATE TABLE rollback_probe (value INTEGER)");
    await expect(
      database.transaction(async (transaction) => {
        await transaction.exec("INSERT INTO rollback_probe (value) VALUES (1)");
        await transaction.exec("COMMIT");
        throw new Error("rejected after an escaped commit");
      }),
    ).rejects.toThrow(AggregateError);
    expect(await database.get("SELECT value FROM rollback_probe")).toEqual({ value: 1 });
    await database.close();
  });

  it("awaits async transaction settlement and adopts IDs only after success", async () => {
    const database = new ControlledSettlementDatabase(await openNodeSqliteDatabase(":memory:"));
    database.controlNextSettlement("delay");
    const opening = SqliteStorage.open(database);
    let opened = false;
    void opening.then(() => {
      opened = true;
    });
    await Promise.resolve();
    expect(opened).toBe(false);
    database.settle();
    const storage = await opening;
    await expectDelayedCommit(database, storage);
    await expectRejectedCommit(database, storage);
  });
});

describe("portable SQLite facade settlement", () => {
  it("reads a document from one committed state while a commit replaces its base", async () => {
    const id = idFromNumber<DocumentId>(5);
    // Each yield count starts the commit at a different point of the read's record and revision queries.
    for await (const yields of Array.from({ length: 16 }, (_, i) => i)) {
      const storage = await SqliteStorage.open(await openNodeSqliteDatabase(":memory:"));
      await storage.commit(
        [
          {
            type: "document.create",
            record: { id, kind: "replaced", scope: { kind: "session" } },
            content: { kind: "base", version: 1, value: { value: 1 } },
          },
        ],
        BACKGROUND_CONTEXT,
      );
      const read = storage.document(id, "current", BACKGROUND_CONTEXT);
      await Array.from({ length: yields }).reduce<Promise<void>>(
        (pending) => pending.then(() => undefined),
        Promise.resolve(),
      );
      const replace = storage.commit(
        [
          {
            type: "document.change",
            id,
            content: { kind: "base", version: 1, value: { value: 2 } },
          },
        ],
        BACKGROUND_CONTEXT,
      );
      const [stored] = await Promise.all([read, replace]);
      expect([{ value: 1 }, { value: 2 }]).toContainEqual(stored?.value);
      await storage.close(BACKGROUND_CONTEXT);
    }
  });
});
