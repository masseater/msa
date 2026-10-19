import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  round TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  current_state TEXT NOT NULL,
  goal_state TEXT NOT NULL,
  status TEXT NOT NULL,
  cwd TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS threads (
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
CREATE INDEX IF NOT EXISTS threads_project_status ON threads(project, status);
CREATE TABLE IF NOT EXISTS assignments (
  task_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, thread_id, role)
);
CREATE INDEX IF NOT EXISTS assignments_thread ON assignments(thread_id);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
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
  thread_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, thread_id)
);
CREATE TABLE IF NOT EXISTS orchestrator_state (
  project TEXT PRIMARY KEY,
  max_concurrent_threads INTEGER
);
CREATE TABLE IF NOT EXISTS replans (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  reason TEXT NOT NULL,
  after_state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS replans_project ON replans(project, created_at);
`;

function dropReplanUndoColumns(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(replans)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "before_state")) return;
  transaction(database, () => {
    database.exec("ALTER TABLE replans RENAME TO replans_with_undo");
    database.exec(`CREATE TABLE replans (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      reason TEXT NOT NULL,
      after_state TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    database.exec(
      "INSERT INTO replans (id, project, reason, after_state, created_at) SELECT id, project, reason, after_state, created_at FROM replans_with_undo",
    );
    database.exec("DROP TABLE replans_with_undo");
    database.exec("CREATE INDEX IF NOT EXISTS replans_project ON replans(project, created_at)");
  });
}

function columnNames(database: DatabaseSync, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

const LEGACY_TASK_COLUMNS = ["prompt", "priority", "paths", "repos"] as const;

function migrateTasks(database: DatabaseSync): void {
  const names = new Set(columnNames(database, "tasks"));
  if (!names.has("prompt")) return;
  transaction(database, () => {
    if (!names.has("current_state")) {
      database.exec("ALTER TABLE tasks ADD COLUMN current_state TEXT NOT NULL DEFAULT ''");
    }
    if (!names.has("goal_state")) {
      database.exec("ALTER TABLE tasks ADD COLUMN goal_state TEXT NOT NULL DEFAULT ''");
    }
    database.exec("UPDATE tasks SET current_state = prompt WHERE current_state = ''");
    database.exec("UPDATE tasks SET goal_state = title WHERE goal_state = ''");
    for (const column of LEGACY_TASK_COLUMNS) {
      if (names.has(column)) database.exec(`ALTER TABLE tasks DROP COLUMN ${column}`);
    }
  });
}

const THREAD_ID_TABLES = ["assignments", "reports", "note_reads"] as const;

function renameSessionsToThreads(database: DatabaseSync): void {
  const sessions = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
    .get();
  if (sessions === undefined) return;
  transaction(database, () => {
    database.exec("DROP INDEX IF EXISTS sessions_project_status");
    database.exec("DROP INDEX IF EXISTS assignments_session");
    database.exec("ALTER TABLE sessions RENAME TO threads");
    for (const table of THREAD_ID_TABLES) {
      if (columnNames(database, table).includes("session_id")) {
        database.exec(`ALTER TABLE ${table} RENAME COLUMN session_id TO thread_id`);
      }
    }
    if (columnNames(database, "orchestrator_state").includes("max_concurrent_sessions")) {
      database.exec(
        "ALTER TABLE orchestrator_state RENAME COLUMN max_concurrent_sessions TO max_concurrent_threads",
      );
    }
  });
}

function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = OFF");
  renameSessionsToThreads(database);
  database.exec(SCHEMA);
  dropReplanUndoColumns(database);
  migrateTasks(database);
  return database;
}

const depths = new WeakMap<DatabaseSync, number>();

function transaction<T>(database: DatabaseSync, body: () => T): T {
  if ((depths.get(database) ?? 0) > 0) return body();
  depths.set(database, 1);
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    depths.set(database, 0);
  }
}

function definedEntries(value: object): [string, unknown][] {
  return Object.entries(value).filter(([, field]) => field !== undefined);
}

export const db = { openDatabase, transaction, definedEntries };
