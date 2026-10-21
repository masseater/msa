import { Effect } from "effect";

import DurableObjectSqliteExecutor from "./cloudflare-executor.ts";
import SerialQueue from "./cloudflare-queue.ts";
import DurableObjectSqliteTransaction from "./cloudflare-transaction.ts";
import type databaseTypes from "./database.ts";

export default class DurableObjectSqliteDatabase
  extends DurableObjectSqliteExecutor
  implements databaseTypes.SqliteDatabase
{
  private readonly queue = new SerialQueue();

  override exec(sql: string): Promise<void> {
    return this.queue.run(() => super.exec(sql));
  }

  override run(sql: string, ...params: databaseTypes.SqliteValue[]): Promise<void> {
    return this.queue.run(() => super.run(sql, ...params));
  }

  override get<T extends object>(
    sql: string,
    ...params: databaseTypes.SqliteValue[]
  ): Promise<T | undefined> {
    return this.queue.run(() => super.get<T>(sql, ...params));
  }

  override all<T extends object>(
    sql: string,
    ...params: databaseTypes.SqliteValue[]
  ): Promise<T[]> {
    return this.queue.run(() => super.all<T>(sql, ...params));
  }

  transaction<T>(callback: (transaction: databaseTypes.SqliteExecutor) => Promise<T>): Promise<T> {
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
