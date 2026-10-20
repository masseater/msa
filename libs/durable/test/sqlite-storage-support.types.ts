import type sqliteTypes from "../src/storage/sqlite/index.types.ts";
import type nodeTypes from "../src/storage/sqlite/node.types.ts";

declare namespace sqliteStorageSupportTypes {
  type SqliteStorage = sqliteTypes.SqliteStorage;

  type NodeSqliteStorageOptions = nodeTypes.NodeSqliteStorageOptions;
}

export type { sqliteStorageSupportTypes as default };
