import { Effect } from "effect";

import {
  DurableObjectSqliteExecutor,
  type DurableObjectSqliteStorage,
} from "./cloudflare-executor.ts";
import { SerialQueue } from "./cloudflare-queue.ts";
import { DurableObjectSqliteTransaction } from "./cloudflare-transaction.ts";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "./database.ts";
import { SqliteStorage } from "./storage.ts";

export type { DurableObjectSqliteStorage } from "./cloudflare-executor.ts";

export class DurableObjectSqliteDatabase
  extends DurableObjectSqliteExecutor
  implements SqliteDatabase
{
  private readonly queue = new SerialQueue();

  override exec(sql: string): Promise<void> {
    return this.queue.run(() => super.exec(sql));
  }

  override run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.queue.run(() => super.run(sql, ...params));
  }

  override get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.queue.run(() => super.get<T>(sql, ...params));
  }

  override all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.queue.run(() => super.all<T>(sql, ...params));
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.queue.run(() =>
      this.storage.transaction(() => {
        const transaction = new DurableObjectSqliteTransaction(this.storage);
        return Effect.runPromise(
          Effect.promise(() => callback(transaction)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                transaction.active = false;
              }),
            ),
          ),
        );
      }),
    );
  }

  close(): Promise<void> {
    return this.queue.run(() => {});
  }
}

export function openDurableObjectSqliteStorage(
  storage: DurableObjectSqliteStorage,
): Promise<SqliteStorage> {
  return SqliteStorage.open(new DurableObjectSqliteDatabase(storage));
}
