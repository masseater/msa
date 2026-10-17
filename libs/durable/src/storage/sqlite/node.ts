import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Effect, Function } from "effect";

import { promiseTry } from "../../promise-try.ts";
import type { SqliteDatabase, SqliteExecutor } from "./database.ts";
import { NodeSqliteExecutor } from "./node-executor.ts";
import { SerialOperationQueue } from "./node-queue.ts";
import { NodeSqliteTransaction } from "./node-transaction.ts";
import { SqliteStorage } from "./storage.ts";

export type NodeSqliteStorageOptions = {
  readonly walAutoCheckpointPages?: number;
  readonly busyTimeoutMs?: number;
};

const DEFAULT_WAL_AUTO_CHECKPOINT_PAGES = 1_000;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const rollback = (database: DatabaseSync, error: unknown): void => {
  try {
    database.exec("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [error, rollbackError],
      "SQLite transaction failed and rollback failed",
      { cause: rollbackError },
    );
  }
};

export class NodeSqliteDatabase extends NodeSqliteExecutor implements SqliteDatabase {
  private readonly access = new SerialOperationQueue();
  private closed = false;

  constructor(database: DatabaseSync) {
    super(database, new Map());
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    const { database, statements } = this;
    return this.access.runAsync(() => {
      database.exec("BEGIN IMMEDIATE");
      const scope = { active: true };
      return promiseTry(() => callback(new NodeSqliteTransaction(database, statements, scope)))
        .then((result) => {
          scope.active = false;
          database.exec("COMMIT");
          return result;
        })
        .catch((error: unknown) => {
          scope.active = false;
          rollback(database, error);
          throw error;
        });
    });
  }

  close(): Promise<void> {
    return this.access.run(() => {
      if (this.closed) return;
      this.closed = true;
      this.statements.clear();
      try {
        this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        this.database.close();
      }
    });
  }

  protected runOperation<T>(operation: () => T): Promise<T> {
    return this.access.run(operation);
  }
}

const prepareDirectory = (path: string): Effect.Effect<void> =>
  path === ":memory:"
    ? Effect.void
    : Effect.asVoid(Effect.promise(() => mkdir(dirname(path), { recursive: true })));

const configure = Effect.fnUntraced(function* (
  adapter: NodeSqliteDatabase,
  checkpointPages: number,
) {
  yield* Effect.promise(() => adapter.exec("PRAGMA journal_mode = WAL"));
  yield* Effect.promise(() => adapter.exec("PRAGMA synchronous = NORMAL"));
  yield* Effect.promise(() => adapter.exec(`PRAGMA wal_autocheckpoint = ${checkpointPages}`));
});

const openDatabase = Effect.fnUntraced(function* (path: string, options: NodeSqliteStorageOptions) {
  const checkpointPages = options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;
  const timeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  yield* prepareDirectory(path);
  const adapter = new NodeSqliteDatabase(new DatabaseSync(path, { timeout }));
  yield* configure(adapter, checkpointPages).pipe(
    Effect.onError(() => Effect.ignoreCause(Effect.promise(() => adapter.close()))),
  );
  return adapter;
});

type Open<T> = {
  (options?: NodeSqliteStorageOptions): (path: string) => Promise<T>;
  (path: string, options?: NodeSqliteStorageOptions): Promise<T>;
};

const isPath = (args: IArguments): boolean => typeof args[0] === "string";

export const openNodeSqliteDatabase: Open<NodeSqliteDatabase> = Function.dual(
  isPath,
  (path: string, options: NodeSqliteStorageOptions = {}): Promise<NodeSqliteDatabase> =>
    Effect.runPromise(openDatabase(path, options)),
);

export const openNodeSqliteStorage: Open<SqliteStorage> = Function.dual(
  isPath,
  (path: string, options: NodeSqliteStorageOptions = {}): Promise<SqliteStorage> =>
    Effect.runPromise(
      openDatabase(path, options).pipe(
        Effect.flatMap((database) => Effect.promise(() => SqliteStorage.open(database))),
      ),
    ),
);
