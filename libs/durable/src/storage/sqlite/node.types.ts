import type node from "./node.ts";
import type storageTypes from "./storage.types.ts";

declare namespace nodeTypes {
  type NodeSqliteStorageOptions = {
    readonly walAutoCheckpointPages?: number;
    readonly busyTimeoutMs?: number;
  };

  type NodeSqliteDatabase = (typeof node.NodeSqliteDatabase)["prototype"];

  type SqliteStorage = storageTypes.SqliteStorage;
}

export type { nodeTypes as default };
