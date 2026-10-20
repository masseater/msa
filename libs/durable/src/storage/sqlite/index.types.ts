import type databaseTypes from "./database.ts";
import type migrationsTypes from "./migrations.types.ts";
import type storageTypes from "./storage.types.ts";

declare namespace sqliteTypes {
  type SqliteDatabase = databaseTypes.SqliteDatabase;

  type SqliteExecutor = databaseTypes.SqliteExecutor;

  type SqliteValue = databaseTypes.SqliteValue;

  type SqliteMigration = migrationsTypes.SqliteMigration;

  type SqliteStorage = storageTypes.SqliteStorage;
}

export type { sqliteTypes as default };
