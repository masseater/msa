import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import {
  applySqliteMigrations,
  CURRENT_SQLITE_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
} from "../src/storage/sqlite/index.ts";
import { openNodeSqliteDatabase, openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import { joinPath, makeTempDir, removeDir } from "./platform-support.ts";

const directories = new Set<string>();

const databasePath = Effect.fn("databasePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-migrations-");
  directories.add(directory);
  return joinPath(directory, "storage.sqlite");
});

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const storedBeforeMigration = Effect.fn("storedBeforeMigration")(function* () {
  const path = yield* databasePath();
  const storage = yield* awaited(openNodeSqliteStorage(path));
  yield* awaited(
    storage.commit(
      [
        { type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
        {
          type: "entry",
          value: {
            id: idFromNumber<EntryId>(2),
            conversationId: ROOT_CONVERSATION_ID,
            kind: "retained",
            data: { retained: true },
          },
        },
      ],
      BACKGROUND_CONTEXT,
    ),
  );
  yield* awaited(storage.close(BACKGROUND_CONTEXT));
  return { path };
});

const createsCurrentSchema = Effect.gen(function* () {
  const database = yield* awaited(openNodeSqliteDatabase(yield* databasePath()));
  yield* Effect.gen(function* () {
    yield* awaited(applySqliteMigrations(database));
    yield* awaited(applySqliteMigrations(database));
    expect(
      yield* awaited(database.get("SELECT version FROM durable_schema WHERE singleton = 1")),
    ).toEqual({
      version: CURRENT_SQLITE_SCHEMA_VERSION,
    });
    expect(
      yield* awaited(
        database.get("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1"),
      ),
    ).toEqual({
      next_id: "2",
      next_seq: 1,
    });
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(database.close())))));
});

const rejectsDatabaseNewer = Effect.gen(function* () {
  const path = yield* databasePath();
  const database = yield* awaited(openNodeSqliteDatabase(path));
  yield* awaited(applySqliteMigrations(database));
  yield* awaited(
    database.run(
      "UPDATE durable_schema SET version = ? WHERE singleton = 1",
      CURRENT_SQLITE_SCHEMA_VERSION + 1,
    ),
  );
  yield* awaited(database.close());

  yield* awaited(
    expect(openNodeSqliteStorage(path)).rejects.toThrow("is newer than supported version"),
  );
});

describe("durable SQLite migrations", () => {
  it("creates the current schema and can be applied repeatedly", () =>
    Effect.runPromise(createsCurrentSchema));

  it("rejects a database newer than the portable core", () =>
    Effect.runPromise(rejectsDatabaseNewer));
});

const rollsInitialBootstrap = Effect.gen(function* () {
  const database = yield* awaited(openNodeSqliteDatabase(yield* databasePath()));
  yield* Effect.gen(function* () {
    const first: SqliteMigration = {
      version: 1,
      statements: [
        "CREATE TABLE migration_first (value TEXT) STRICT",
        "INSERT INTO migration_first (value) VALUES ('retained')",
      ],
    };
    const failed: readonly SqliteMigration[] = [
      first,
      {
        version: 2,
        statements: ["CREATE TABLE migration_second (value TEXT) STRICT", "THIS IS NOT SQL"],
      },
    ];
    yield* awaited(expect(applySqliteMigrations(database, failed)).rejects.toThrow());
    expect(
      yield* awaited(
        database.get(
          "SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('durable_schema', 'migration_first', 'migration_second')",
        ),
      ),
    ).toEqual({ count: 0 });

    yield* awaited(
      applySqliteMigrations(database, [
        first,
        { version: 2, statements: ["CREATE TABLE migration_second (value TEXT) STRICT"] },
      ]),
    );
    expect(
      yield* awaited(database.get("SELECT version FROM durable_schema WHERE singleton = 1")),
    ).toEqual({
      version: 2,
    });
    expect(yield* awaited(database.get("SELECT value FROM migration_first"))).toEqual({
      value: "retained",
    });
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(database.close())))));
});

describe("durable SQLite migrations", () => {
  it("rolls initial bootstrap and every pending migration back together", () =>
    Effect.runPromise(rollsInitialBootstrap));
});

const rollsFailedMigration = Effect.gen(function* () {
  const { path } = yield* storedBeforeMigration();

  const database = yield* awaited(openNodeSqliteDatabase(path));
  const nextVersion = CURRENT_SQLITE_SCHEMA_VERSION + 1;
  const failedMigrations: readonly SqliteMigration[] = [
    ...SQLITE_MIGRATIONS,
    {
      version: nextVersion,
      statements: ["CREATE TABLE migration_probe (value TEXT) STRICT", "THIS IS NOT SQL"],
    },
  ];
  yield* awaited(expect(applySqliteMigrations(database, failedMigrations)).rejects.toThrow());
  expect(
    yield* awaited(database.get("SELECT version FROM durable_schema WHERE singleton = 1")),
  ).toEqual({
    version: CURRENT_SQLITE_SCHEMA_VERSION,
  });
  expect(
    yield* awaited(
      database.get(
        "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'migration_probe'",
      ),
    ),
  ).toEqual({ count: 0 });

  const successfulMigrations: readonly SqliteMigration[] = [
    ...SQLITE_MIGRATIONS,
    {
      version: nextVersion,
      statements: ["CREATE TABLE migration_probe (value TEXT) STRICT"],
    },
  ];
  yield* awaited(applySqliteMigrations(database, successfulMigrations));
  expect(
    yield* awaited(database.get("SELECT version FROM durable_schema WHERE singleton = 1")),
  ).toEqual({
    version: nextVersion,
  });
  expect(
    yield* awaited(database.get("SELECT record, commit_seq FROM entries WHERE id = 2")),
  ).toEqual({
    record: yield* toJsonText({
      id: 2,
      conversationId: ROOT_CONVERSATION_ID,
      kind: "retained",
      data: { retained: true },
    }),
    commit_seq: 1,
  });
  expect(
    yield* awaited(
      database.get("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1"),
    ),
  ).toEqual({
    next_id: "3",
    next_seq: 2,
  });
  yield* awaited(database.close());
});

describe("durable SQLite migrations", () => {
  it("rolls a failed migration back and preserves stored data for a successful retry", () =>
    Effect.runPromise(rollsFailedMigration));
});
