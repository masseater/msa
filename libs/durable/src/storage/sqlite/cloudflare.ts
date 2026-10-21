import DurableObjectSqliteDatabase from "./cloudflare-database.ts";
import type cloudflareExecutorTypes from "./cloudflare-executor.types.ts";
import SqliteStorage from "./storage.ts";
import type storageTypes from "./storage.types.ts";

function openDurableObjectSqliteStorage(
  storage: cloudflareExecutorTypes.DurableObjectSqliteStorage,
): Promise<storageTypes.SqliteStorage> {
  return SqliteStorage.open(new DurableObjectSqliteDatabase(storage));
}

const cloudflare = {
  DurableObjectSqliteDatabase,
  openDurableObjectSqliteStorage,
};

export default cloudflare;
