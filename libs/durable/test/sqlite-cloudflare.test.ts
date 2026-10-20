import { DatabaseSync } from "node:sqlite";

import { registerStorageConformance } from "@msa/durable/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  DurableObjectSqliteDatabase,
  type DurableObjectSqliteStorage,
  openDurableObjectSqliteStorage,
} from "../src/storage/sqlite/cloudflare.ts";
import effectSupport from "./effect-support.ts";

const { awaited } = effectSupport;

type SqlValue = ArrayBuffer | string | number | null;

function durableObjectStorage(database = new DatabaseSync(":memory:")): DurableObjectSqliteStorage {
  const toNode = (value: SqlValue) =>
    value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  const fromNode = (value: unknown): SqlValue =>
    value instanceof Uint8Array ? (value.slice().buffer as ArrayBuffer) : (value as SqlValue);
  return {
    sql: {
      exec(query, ...bindings) {
        if (bindings.length === 0 && query.trim().replace(/;\s*$/u, "").includes(";")) {
          database.exec(query);
          return { toArray: () => [] };
        }
        const statement = database.prepare(query);
        if (statement.columns().length === 0) {
          statement.run(...bindings.map(toNode));
          return { toArray: () => [] };
        }
        const rows = statement.all(...bindings.map(toNode)) as Record<string, unknown>[];
        return {
          toArray: () =>
            rows.map((row) =>
              Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromNode(value)])),
            ),
        };
      },
    },
    transaction(closure) {
      return Effect.runPromise(
        Effect.gen(function* () {
          database.exec("BEGIN");
          return yield* awaited(closure()).pipe(
            Effect.tap(() => Effect.sync(() => database.exec("COMMIT"))),
            Effect.tapDefect(() => Effect.sync(() => database.exec("ROLLBACK"))),
          );
        }),
      );
    },
  };
}

registerStorageConformance({ describe, expect, it }, "SqliteStorage on a Durable Object", (use) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* awaited(
        use(yield* awaited(openDurableObjectSqliteStorage(durableObjectStorage()))),
      );
    }),
  ),
);

const bindsReturnsBlob = Effect.gen(function* () {
  const database = new DurableObjectSqliteDatabase(durableObjectStorage());
  yield* awaited(
    database.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB, n INTEGER)"),
  );
  yield* awaited(
    database.run(
      "INSERT INTO blobs (id, data, n) VALUES (?, ?, ?)",
      1,
      new Uint8Array([1, 2, 3]),
      7n,
    ),
  );
  expect(yield* awaited(database.get("SELECT data, n FROM blobs WHERE id = ?", 1))).toEqual({
    data: new Uint8Array([1, 2, 3]),
    n: 7,
  });
});

const rejectsBigintBinding = Effect.gen(function* () {
  const database = new DurableObjectSqliteDatabase(durableObjectStorage());
  yield* awaited(database.exec("CREATE TABLE numbers (n INTEGER)"));
  yield* awaited(
    expect(
      database.run("INSERT INTO numbers (n) VALUES (?)", 9_007_199_254_740_993n),
    ).rejects.toThrow(RangeError),
  );
  expect(yield* awaited(database.all("SELECT n FROM numbers"))).toEqual([]);
});

const closesActiveTransaction = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = new DurableObjectSqliteDatabase(durableObjectStorage());
  yield* awaited(database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)"));
  const order: string[] = [];
  const { promise: gate, resolve } = Promise.withResolvers<void>();
  const transaction = database.transaction((handle) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(handle.run("INSERT INTO items (id) VALUES (?)", 1));
        yield* awaited(gate);
        order.push("transaction");
      }),
    ),
  );
  const closed = database.close().then(() => order.push("close"));
  resolve();
  yield* awaited(Promise.all([transaction, closed]));
  expect(order).toEqual(["transaction", "close"]);
});

describe("Durable Object SQLite adapter", () => {
  it("binds and returns BLOB values as Uint8Array", () => Effect.runPromise(bindsReturnsBlob));

  it("rejects a bigint binding outside the safe integer range", () =>
    Effect.runPromise(rejectsBigintBinding));

  it("closes after an active transaction settles", () =>
    Effect.runPromise(closesActiveTransaction));
});

const rollsBackRejected = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = new DurableObjectSqliteDatabase(durableObjectStorage());
  yield* awaited(database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)"));
  let handle: Parameters<Parameters<DurableObjectSqliteDatabase["transaction"]>[0]>[0] | undefined;
  yield* awaited(
    expect(
      database.transaction((transaction) =>
        runPromise(
          Effect.gen(function* () {
            handle = transaction;
            yield* awaited(transaction.run("INSERT INTO items (id) VALUES (?)", 1));
            throw new Error("abort");
          }),
        ),
      ),
    ).rejects.toThrow("abort"),
  );
  expect(yield* awaited(database.all("SELECT id FROM items"))).toEqual([]);
  yield* awaited(
    expect(handle!.run("INSERT INTO items (id) VALUES (?)", 2)).rejects.toThrow("no longer active"),
  );
});

const queuesOperationsBehind = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const database = new DurableObjectSqliteDatabase(durableObjectStorage());
  yield* awaited(database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)"));
  const order: string[] = [];
  const { promise: gate, resolve } = Promise.withResolvers<void>();
  const transaction = database.transaction((handle) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(handle.run("INSERT INTO items (id) VALUES (?)", 1));
        yield* awaited(gate);
        order.push("transaction");
      }),
    ),
  );
  const read = database.all("SELECT id FROM items").then((rows) => {
    order.push("read");
    return rows;
  });
  resolve();
  yield* awaited(transaction);
  expect(yield* awaited(read)).toEqual([{ id: 1 }]);
  expect(order).toEqual(["transaction", "read"]);
  yield* awaited(database.close());
});

describe("Durable Object SQLite adapter", () => {
  it("rolls back a rejected transaction and rejects its handle afterwards", () =>
    Effect.runPromise(rollsBackRejected));

  it("queues operations behind an active transaction", () =>
    Effect.runPromise(queuesOperationsBehind));
});
