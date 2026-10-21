import migrationsModule from "./migrations.ts";
import SqliteStorage from "./storage.ts";

const sqlite = {
  CURRENT_SQLITE_SCHEMA_VERSION: migrationsModule.CURRENT_SQLITE_SCHEMA_VERSION,
  SQLITE_MIGRATIONS: migrationsModule.SQLITE_MIGRATIONS,
  SqliteStorage: SqliteStorage,
  applySqliteMigrations: migrationsModule.applySqliteMigrations,
};

export default sqlite;
