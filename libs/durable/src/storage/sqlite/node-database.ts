import { DatabaseSync } from "node:sqlite";

import promiseTryModule from "../../promise-try.ts";
import type databaseTypes from "./database.ts";
import NodeSqliteExecutor from "./node-executor.ts";
import SerialOperationQueue from "./node-queue.ts";
import NodeSqliteTransaction from "./node-transaction.ts";

const { promiseTry } = promiseTryModule;

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

export default class NodeSqliteDatabase
  extends NodeSqliteExecutor
  implements databaseTypes.SqliteDatabase
{
  private readonly access = new SerialOperationQueue();
  private closed = false;

  constructor(database: DatabaseSync) {
    super(database, new Map());
  }

  transaction<T>(callback: (transaction: databaseTypes.SqliteExecutor) => Promise<T>): Promise<T> {
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
