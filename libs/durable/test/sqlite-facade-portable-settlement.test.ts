import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "../src/storage/sqlite/index.ts";
import { SqliteStorage } from "../src/storage/sqlite/index.ts";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "../src/storage/sqlite/node.ts";
import { type DocumentId, type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";
import effectSupport from "./effect-support.ts";

const { awaited } = effectSupport;

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
    const settlement = this.delegate.transaction((transaction) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const value = yield* awaited(callback(transaction));
          if (mode === "reject") throw new Error("controlled settlement rejection");
          return value;
        }),
      ),
    );
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pendingSettlement = () => void settlement.then(resolve, reject);
    return promise;
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

const expectDelayedCommit = Effect.fn("expectDelayedCommit")(function* (
  database: ControlledSettlementDatabase,
  storage: SqliteStorage,
) {
  database.controlNextSettlement("delay");
  const committing = storage.commit(
    [
      {
        type: "entry",
        value: {
          conversationId: ROOT_CONVERSATION_ID,
          id: idFromNumber<EntryId>(100),
          kind: "settled",
        },
      },
    ],
    BACKGROUND_CONTEXT,
  );
  let committed = false;
  void committing.then(() => {
    committed = true;
    return undefined;
  });
  yield* awaited(Promise.resolve());
  expect(committed).toBe(false);
  expect(yield* awaited(storage.mintId<EntryId>())).toBe(2);
  database.settle();
  yield* awaited(expect(committing).resolves.toBe(1));
  expect(yield* awaited(storage.mintId<EntryId>())).toBe(101);
});

const expectRejectedCommit = Effect.fn("expectRejectedCommit")(function* (
  database: ControlledSettlementDatabase,
  storage: SqliteStorage,
) {
  database.controlNextSettlement("reject");
  const rejected = storage.commit(
    [
      {
        type: "entry",
        value: {
          conversationId: ROOT_CONVERSATION_ID,
          id: idFromNumber<EntryId>(200),
          kind: "rejected",
        },
      },
    ],
    BACKGROUND_CONTEXT,
  );
  expect(yield* awaited(storage.mintId<EntryId>())).toBe(102);
  database.settle();
  yield* awaited(expect(rejected).rejects.toThrow("controlled settlement rejection"));
  expect(yield* awaited(storage.mintId<EntryId>())).toBe(103);
  expect(
    yield* awaited(storage.entry(idFromNumber<EntryId>(200), BACKGROUND_CONTEXT)),
  ).toBeUndefined();
  yield* awaited(storage.close(BACKGROUND_CONTEXT));
});

const rejectsTransactionHandle = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(database.exec("CREATE TABLE stale_probe (value INTEGER)"));
  let handle!: SqliteExecutor;
  yield* awaited(
    database.transaction((transaction) =>
      runPromise(
        Effect.gen(function* () {
          handle = transaction;
          yield* awaited(transaction.run("INSERT INTO stale_probe (value) VALUES (?)", 1));
        }),
      ),
    ),
  );
  const stale = "SQLite transaction handle is no longer active";
  yield* awaited(
    expect(handle.exec("INSERT INTO stale_probe (value) VALUES (2)")).rejects.toThrow(stale),
  );
  yield* awaited(
    expect(handle.run("INSERT INTO stale_probe (value) VALUES (?)", 3)).rejects.toThrow(stale),
  );
  expect(yield* awaited(database.all("SELECT value FROM stale_probe"))).toEqual([{ value: 1 }]);
  yield* awaited(database.close());
});

const doesNotPreserve = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = yield* awaited(openNodeSqliteDatabase(":memory:"));
  yield* awaited(database.exec("CREATE TABLE rollback_probe (value INTEGER)"));
  yield* awaited(
    expect(
      database.transaction((transaction) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(transaction.exec("INSERT INTO rollback_probe (value) VALUES (1)"));
            yield* awaited(transaction.exec("COMMIT"));
            throw new Error("rejected after an escaped commit");
          }),
        ),
      ),
    ).rejects.toThrow(AggregateError),
  );
  expect(yield* awaited(database.get("SELECT value FROM rollback_probe"))).toEqual({
    value: 1,
  });
  yield* awaited(database.close());
});

const awaitsAsyncTransaction = Effect.gen(function* () {
  const database = new ControlledSettlementDatabase(
    yield* awaited(openNodeSqliteDatabase(":memory:")),
  );
  database.controlNextSettlement("delay");
  const opening = SqliteStorage.open(database);
  let opened = false;
  void opening.then(() => {
    opened = true;
    return undefined;
  });
  yield* awaited(Promise.resolve());
  expect(opened).toBe(false);
  database.settle();
  const storage = yield* awaited(opening);
  yield* expectDelayedCommit(database, storage);
  yield* expectRejectedCommit(database, storage);
});

describe("portable SQLite facade settlement", () => {
  it("rejects a transaction handle used after its transaction settles", () =>
    Effect.runPromise(rejectsTransactionHandle));

  it("does not preserve the callback error when rollback itself fails", () =>
    Effect.runPromise(doesNotPreserve));

  it("awaits async transaction settlement and adopts IDs only after success", () =>
    Effect.runPromise(awaitsAsyncTransaction));
});

const readsDocumentOne = Effect.gen(function* () {
  const id = idFromNumber<DocumentId>(5);
  for (const yields of Array.from({ length: 16 }, (_, i) => i)) {
    const storage = yield* awaited(
      SqliteStorage.open(yield* awaited(openNodeSqliteDatabase(":memory:"))),
    );
    yield* awaited(
      storage.commit(
        [
          {
            content: { kind: "base", value: { value: 1 }, version: 1 },
            record: { id, kind: "replaced", scope: { kind: "session" } },
            type: "document.create",
          },
        ],
        BACKGROUND_CONTEXT,
      ),
    );
    const read = storage.document(id, "current", BACKGROUND_CONTEXT);
    yield* awaited(
      Array.from({ length: yields }).reduce<Promise<void>>(
        (pending) => pending.then(() => undefined),
        Promise.resolve(),
      ),
    );
    const replace = storage.commit(
      [
        {
          content: { kind: "base", value: { value: 2 }, version: 1 },
          id,
          type: "document.change",
        },
      ],
      BACKGROUND_CONTEXT,
    );
    const [stored] = yield* awaited(Promise.all([read, replace]));
    expect([{ value: 1 }, { value: 2 }]).toContainEqual(stored?.value);
    yield* awaited(storage.close(BACKGROUND_CONTEXT));
  }
});

describe("portable SQLite facade settlement", () => {
  it("reads a document from one committed state while a commit replaces its base", () =>
    Effect.runPromise(readsDocumentOne));
});
