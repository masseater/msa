import { Duration, Effect, Schedule } from "effect";

import type ForeignError from "../platform/foreign-error.ts";
import sqliteFile from "../platform/node/sqlite-file.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import IndexLocked from "./index-locked.ts";
import indexOpen from "./index-open.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const { foreign, isLockWait } = indexOpen;

const LOCK_RETRY = Schedule.spaced(Duration.millis(20));
const LOCK_RETRIES = 500;

const whileLocked = <A>(
  indexPath: string,
  body: () => A,
): Effect.Effect<A, ForeignError | IndexLocked> =>
  foreign(body).pipe(
    Effect.retry({
      schedule: LOCK_RETRY,
      times: LOCK_RETRIES,
      while: (failure) => isLockWait(failure.cause),
    }),
    Effect.catchIf(
      (failure) => isLockWait(failure.cause),
      (failure) =>
        Effect.fail(
          new IndexLocked({
            cause: failure.cause,
            message: `The session index ${indexPath} stayed locked by another process (${failure.message}); search again once it finishes`,
          }),
        ),
    ),
  );

const SCHEMA_VERSION = 2;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  indexed INTEGER NOT NULL,
  tail BLOB NOT NULL,
  session_id TEXT,
  cwd TEXT,
  started_at INTEGER,
  orchestrator INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  length INTEGER NOT NULL,
  part INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT,
  entry_id TEXT,
  at INTEGER
);
CREATE INDEX IF NOT EXISTS parts_file ON parts(file_id, offset);
CREATE VIRTUAL TABLE IF NOT EXISTS parts_fts USING fts5(body, content='', contentless_delete=1);
`;

type FileRow = sessionSearchTypes.FileRow;
type FileUpdate = sessionSearchTypes.FileUpdate;
type PartRow = sessionSearchTypes.PartRow;
type RowId = number | bigint;

function write(database: DatabaseSync, sql: string) {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  return statement;
}

function openCurrent(path: string): DatabaseSync | undefined {
  const database = openIndex(path);
  try {
    const { user_version: version } = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version === SCHEMA_VERSION) return database;
  } catch (error) {
    database.close();
    throw error;
  }
  database.close();
  return undefined;
}

function createSchema(database: DatabaseSync): void {
  database.exec(SCHEMA);
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function openIndex(path: string): DatabaseSync {
  const database = sqliteFile.openSqliteFile(path, { timeout: 0 });
  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

const FILE_ROW = "SELECT id, path, size, mtime, indexed, tail FROM files";

function fileRows(database: DatabaseSync): FileRow[] {
  return database.prepare(FILE_ROW).all() as unknown as FileRow[];
}

function fileRow(database: DatabaseSync, path: string): FileRow | undefined {
  return database.prepare(`${FILE_ROW} WHERE path = ?`).get(path) as FileRow | undefined;
}

const sameRow = (left: FileRow | undefined, right: FileRow | undefined): boolean =>
  left === undefined || right === undefined ? left === right : left.size === right.size;

function transaction<T>(database: DatabaseSync, body: () => T): T {
  if (database.isTransaction) return body();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function deleteParts(database: DatabaseSync, fileId: RowId): void {
  write(
    database,
    "DELETE FROM parts_fts WHERE rowid IN (SELECT id FROM parts WHERE file_id = ?)",
  ).run(fileId);
  write(database, "DELETE FROM parts WHERE file_id = ?").run(fileId);
}

function removeFiles(database: DatabaseSync, paths: readonly string[]): number {
  if (paths.length === 0) return 0;
  return transaction(database, () =>
    paths
      .flatMap((path) => fileRow(database, path) ?? [])
      .map((current) => {
        deleteParts(database, current.id);
        write(database, "DELETE FROM files WHERE id = ?").run(current.id);
        return current.path;
      }),
  ).length;
}

function upsertFile(
  database: DatabaseSync,
  update: FileUpdate,
  current: FileRow | undefined,
): RowId {
  if (current === undefined) {
    const inserted = write(
      database,
      "INSERT INTO files (path, size, mtime, indexed, tail) VALUES (?, ?, ?, ?, ?) RETURNING id",
    ).get(update.path, update.size, update.mtime, update.indexed, update.tail) as { id: bigint };
    return inserted.id;
  }
  if (update.from === 0) deleteParts(database, current.id);
  write(database, "UPDATE files SET size = ?, mtime = ?, indexed = ?, tail = ? WHERE id = ?").run(
    update.size,
    update.mtime,
    update.indexed,
    update.tail,
    current.id,
  );
  if (update.from === 0) {
    write(
      database,
      "UPDATE files SET session_id = NULL, cwd = NULL, started_at = NULL, orchestrator = 0 WHERE id = ?",
    ).run(current.id);
  }
  return current.id;
}

function insertParts(database: DatabaseSync, fileId: RowId, parts: readonly PartRow[]): void {
  const insertPart = write(
    database,
    `INSERT INTO parts (file_id, offset, length, part, kind, tool, entry_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertBody = write(database, "INSERT INTO parts_fts (rowid, body) VALUES (?, ?)");
  for (const part of parts) {
    const { id } = insertPart.get(
      fileId,
      part.offset,
      part.length,
      part.part,
      part.kind,
      part.tool,
      part.entryId,
      part.at,
    ) as { id: bigint };
    insertBody.run(id, part.body);
  }
}

function applyFileUpdate(database: DatabaseSync, update: FileUpdate): boolean {
  const current = fileRow(database, update.path);
  if (!sameRow(current, update.basis)) return false;
  const fileId = upsertFile(database, update, current);
  insertParts(database, fileId, update.parts);
  if (update.header !== undefined) {
    write(database, "UPDATE files SET session_id = ?, cwd = ?, started_at = ? WHERE id = ?").run(
      update.header.sessionId,
      update.header.cwd,
      update.header.startedAt,
      fileId,
    );
  }
  if (update.orchestrator) {
    write(database, "UPDATE files SET orchestrator = 1 WHERE id = ?").run(fileId);
  }
  write(database, "UPDATE files SET error = ? WHERE id = ?").run(update.failure ?? null, fileId);
  return true;
}

function applyUpdates(database: DatabaseSync, updates: readonly FileUpdate[]): string[] {
  if (updates.length === 0) return [];
  return transaction(database, () =>
    updates.filter((update) => !applyFileUpdate(database, update)).map((update) => update.path),
  );
}

function skippedFiles(database: DatabaseSync): sessionSearchTypes.SkippedFile[] {
  return database
    .prepare("SELECT path, error AS reason FROM files WHERE error IS NOT NULL ORDER BY path")
    .all() as unknown as sessionSearchTypes.SkippedFile[];
}

const indexStore = {
  SCHEMA_VERSION,
  applyUpdates,
  createSchema,
  fileRow,
  fileRows,
  openCurrent,
  openIndex,
  removeFiles,
  skippedFiles,
  whileLocked,
};

export default indexStore;
