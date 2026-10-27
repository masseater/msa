import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import DatabaseSync from "./sqlite.ts";

const openSqliteFile = (path: string, options: { timeout: number }): DatabaseSync => {
  mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path, options);
};

const removeSqliteFile = (path: string): void => {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true });
};

const sqliteFile = { openSqliteFile, removeSqliteFile };

export default sqliteFile;
