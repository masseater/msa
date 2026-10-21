import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import DatabaseSync from "./sqlite.ts";

const openSqliteFile = (path: string, options: { timeout: number }): DatabaseSync => {
  mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path, options);
};

const sqliteFile = { openSqliteFile };

export default sqliteFile;
