import type { SqliteStorage as SqliteStorageSource } from "../src/storage/sqlite/index.ts";
import type { NodeSqliteStorageOptions as NodeSqliteStorageOptionsSource } from "../src/storage/sqlite/node.ts";

declare namespace sqliteStorageSupportTypes {
  type SqliteStorage = SqliteStorageSource;

  type NodeSqliteStorageOptions = NodeSqliteStorageOptionsSource;
}

export type { sqliteStorageSupportTypes as default };
