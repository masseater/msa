import sqliteFile from "../platform/node/sqlite-file.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const SCHEMA_VERSION = 1;

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
  orchestrator INTEGER NOT NULL DEFAULT 0
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

function resetSchema(database: DatabaseSync): void {
  database.exec("DROP TABLE IF EXISTS parts_fts");
  database.exec("DROP TABLE IF EXISTS parts");
  database.exec("DROP TABLE IF EXISTS files");
}

function openIndex(path: string): DatabaseSync {
  const database = sqliteFile.openSqliteFile(path, { timeout: 30_000 });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  const { user_version: version } = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (version !== SCHEMA_VERSION) resetSchema(database);
  database.exec(SCHEMA);
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return database;
}

function fileRows(database: DatabaseSync): FileRow[] {
  return database
    .prepare("SELECT id, path, size, mtime, indexed, tail FROM files")
    .all() as unknown as FileRow[];
}

function transaction<T>(database: DatabaseSync, body: () => T): T {
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

function deleteParts(database: DatabaseSync, fileId: number): void {
  database
    .prepare("DELETE FROM parts_fts WHERE rowid IN (SELECT id FROM parts WHERE file_id = ?)")
    .run(fileId);
  database.prepare("DELETE FROM parts WHERE file_id = ?").run(fileId);
}

function removeFile(database: DatabaseSync, path: string): void {
  transaction(database, () => {
    const row = database.prepare("SELECT id FROM files WHERE path = ?").get(path) as
      | { id: number }
      | undefined;
    if (row === undefined) return;
    deleteParts(database, row.id);
    database.prepare("DELETE FROM files WHERE id = ?").run(row.id);
  });
}

function upsertFile(database: DatabaseSync, update: FileUpdate, current: FileRow | undefined) {
  if (current === undefined) {
    const inserted = database
      .prepare(
        "INSERT INTO files (path, size, mtime, indexed, tail) VALUES (?, ?, ?, ?, ?) RETURNING id",
      )
      .get(update.path, update.size, update.mtime, update.indexed, update.tail) as { id: number };
    return inserted.id;
  }
  if (update.from === 0) deleteParts(database, current.id);
  database
    .prepare("UPDATE files SET size = ?, mtime = ?, indexed = ?, tail = ? WHERE id = ?")
    .run(update.size, update.mtime, update.indexed, update.tail, current.id);
  if (update.from === 0) {
    database
      .prepare(
        "UPDATE files SET session_id = NULL, cwd = NULL, started_at = NULL, orchestrator = 0 WHERE id = ?",
      )
      .run(current.id);
  }
  return current.id;
}

function insertParts(database: DatabaseSync, fileId: number, parts: readonly PartRow[]): void {
  const insertPart = database.prepare(
    `INSERT INTO parts (file_id, offset, length, part, kind, tool, entry_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertBody = database.prepare("INSERT INTO parts_fts (rowid, body) VALUES (?, ?)");
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
    ) as { id: number };
    insertBody.run(id, part.body);
  }
}

function applyFileUpdate(database: DatabaseSync, update: FileUpdate): void {
  const current = database
    .prepare("SELECT id, path, size, mtime, indexed, tail FROM files WHERE path = ?")
    .get(update.path) as FileRow | undefined;
  const expected = current === undefined ? 0 : current.indexed;
  if (update.from !== 0 && update.from !== expected) return;
  const fileId = upsertFile(database, update, current);
  insertParts(database, fileId, update.parts);
  if (update.header !== undefined) {
    database
      .prepare("UPDATE files SET session_id = ?, cwd = ?, started_at = ? WHERE id = ?")
      .run(update.header.sessionId, update.header.cwd, update.header.startedAt, fileId);
  }
  if (update.orchestrator) {
    database.prepare("UPDATE files SET orchestrator = 1 WHERE id = ?").run(fileId);
  }
}

function applyUpdates(database: DatabaseSync, updates: readonly FileUpdate[]): void {
  if (updates.length === 0) return;
  transaction(database, () => {
    for (const update of updates) applyFileUpdate(database, update);
  });
}

const indexStore = { applyUpdates, fileRows, openIndex, removeFile };

export default indexStore;
