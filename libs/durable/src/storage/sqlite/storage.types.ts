import type SqliteStorageClass from "./storage.ts";

declare namespace storageTypes {
  type SqliteStorage = SqliteStorageClass;
}

export type { storageTypes as default };
