// oxlint-disable-next-line effecttsgo/node-builtin-import -- node:sqlite has no Effect counterpart
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { parentDir } from "./text.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  round TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  cwd TEXT NOT NULL,
  paths TEXT NOT NULL DEFAULT '[]',
  repos TEXT NOT NULL DEFAULT '[]',
  condition TEXT,
  model TEXT,
  thinking_level TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project_status ON tasks(project, status);
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on)
);
CREATE INDEX IF NOT EXISTS task_dependencies_depends_on ON task_dependencies(depends_on);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT NOT NULL,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project, id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  model TEXT NOT NULL,
  thinking_level TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  session_file TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_project_status ON sessions(project, status);
CREATE TABLE IF NOT EXISTS assignments (
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, session_id, role)
);
CREATE INDEX IF NOT EXISTS assignments_session ON assignments(session_id);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_task ON reports(task_id);
CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(report_id UNINDEXED, terms);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  round TEXT,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS note_targets (
  note_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (note_id, task_id)
);
CREATE TABLE IF NOT EXISTS note_reads (
  note_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, session_id)
);
CREATE TABLE IF NOT EXISTS orchestrator_state (
  project TEXT PRIMARY KEY,
  max_concurrent_sessions INTEGER
);
`;

function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(parentDir(path), { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(SCHEMA);
  return database;
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

function definedEntries(value: object): [string, unknown][] {
  return Object.entries(value).filter(([, field]) => field !== undefined);
}

export const db = { openDatabase, transaction, definedEntries };
