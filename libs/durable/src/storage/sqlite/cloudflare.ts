import { promiseTry } from "../../promise-try.ts";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "./database.ts";
import { SqliteStorage } from "./storage.ts";

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

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
}

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

class DurableObjectSqliteExecutor implements SqliteExecutor {
  protected readonly storage: DurableObjectSqliteStorage;

  constructor(storage: DurableObjectSqliteStorage) {
    this.storage = storage;
  }

  exec(sql: string): Promise<void> {
    return promiseTry(() => {
      this.check();
      this.storage.sql.exec(sql);
    });
  }

  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return promiseTry(() => {
      this.check();
      this.storage.sql.exec(sql, ...bind(params));
    });
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return promiseTry(() => {
      this.check();
      return rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray())[0];
    });
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return promiseTry(() => {
      this.check();
      return rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray());
    });
  }

  protected check(): void {}
}

class DurableObjectSqliteTransaction extends DurableObjectSqliteExecutor {
  active = true;

  protected override check(): void {
    if (!this.active) throw new Error("SQLite transaction handle is no longer active");
  }
}

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
      this.storage.transaction(async () => {
        const transaction = new DurableObjectSqliteTransaction(this.storage);
        try {
          return await callback(transaction);
        } finally {
          transaction.active = false;
        }
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
