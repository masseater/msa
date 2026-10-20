import { Effect } from "effect";

import type cloudflareExecutorTypes from "./cloudflare-executor.types.ts";
import type databaseTypes from "./database.ts";

function bindValue(
  value: databaseTypes.SqliteValue,
): cloudflareExecutorTypes.DurableObjectSqlValue {
  if (value instanceof Uint8Array) return value.slice().buffer as ArrayBuffer;
  if (typeof value !== "bigint") return value;
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Durable Object SQL cannot bind ${value} without losing precision`);
  }
  return Number(value);
}

const bind = (
  params: readonly databaseTypes.SqliteValue[],
): cloudflareExecutorTypes.DurableObjectSqlValue[] => params.map(bindValue);

function rows<T>(input: Record<string, cloudflareExecutorTypes.DurableObjectSqlValue>[]): T[] {
  for (const row of input) {
    for (const key in row) {
      const value = row[key];
      if (value instanceof ArrayBuffer)
        (row as Record<string, unknown>)[key] = new Uint8Array(value);
    }
  }
  return input as T[];
}

export default class DurableObjectSqliteExecutor implements databaseTypes.SqliteExecutor {
  protected readonly storage: cloudflareExecutorTypes.DurableObjectSqliteStorage;

  constructor(storage: cloudflareExecutorTypes.DurableObjectSqliteStorage) {
    this.storage = storage;
  }

  exec(sql: string): Promise<void> {
    return this.checked(() => {
      this.storage.sql.exec(sql);
    });
  }

  run(sql: string, ...params: databaseTypes.SqliteValue[]): Promise<void> {
    return this.checked(() => {
      this.storage.sql.exec(sql, ...bind(params));
    });
  }

  get<T extends object>(
    sql: string,
    ...params: databaseTypes.SqliteValue[]
  ): Promise<T | undefined> {
    return this.checked(() => rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray())[0]);
  }

  all<T extends object>(sql: string, ...params: databaseTypes.SqliteValue[]): Promise<T[]> {
    return this.checked(() => rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray()));
  }

  protected check(): void {}

  private checked<T>(operation: () => T): Promise<T> {
    return Effect.runPromise(
      Effect.sync(() => {
        this.check();
        return operation();
      }),
    );
  }
}
