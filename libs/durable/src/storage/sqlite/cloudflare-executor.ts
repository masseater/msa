import { Effect } from "effect";

import type { SqliteExecutor, SqliteValue } from "./database.ts";

type DurableObjectSqlValue = ArrayBuffer | string | number | null;

export type DurableObjectSqliteStorage = {
  readonly sql: {
    exec(
      query: string,
      ...bindings: DurableObjectSqlValue[]
    ): { toArray(): Record<string, DurableObjectSqlValue>[] };
  };
  transaction<T>(closure: () => Promise<T>): Promise<T>;
};

function bindValue(value: SqliteValue): DurableObjectSqlValue {
  if (value instanceof Uint8Array) return value.slice().buffer as ArrayBuffer;
  if (typeof value !== "bigint") return value;
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Durable Object SQL cannot bind ${value} without losing precision`);
  }
  return Number(value);
}

const bind = (params: readonly SqliteValue[]): DurableObjectSqlValue[] => params.map(bindValue);

function rows<T>(input: Record<string, DurableObjectSqlValue>[]): T[] {
  for (const row of input) {
    for (const key in row) {
      const value = row[key];
      if (value instanceof ArrayBuffer)
        (row as Record<string, unknown>)[key] = new Uint8Array(value);
    }
  }
  return input as T[];
}

export class DurableObjectSqliteExecutor implements SqliteExecutor {
  protected readonly storage: DurableObjectSqliteStorage;

  constructor(storage: DurableObjectSqliteStorage) {
    this.storage = storage;
  }

  exec(sql: string): Promise<void> {
    return this.checked(() => {
      this.storage.sql.exec(sql);
    });
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.checked(() => {
      this.storage.sql.exec(sql, ...bind(params));
    });
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.checked(() => rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray())[0]);
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
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
