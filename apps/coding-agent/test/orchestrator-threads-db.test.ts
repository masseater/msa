import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "vite-plus/test";

import { store } from "../src/core/orchestrator/store.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function legacyDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "msa-orchestrator-threads-"));
  directories.push(directory);
  const path = join(directory, "orchestrator.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, round TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, current_state TEXT NOT NULL, goal_state TEXT NOT NULL,
      status TEXT NOT NULL, cwd TEXT NOT NULL, condition TEXT, model TEXT, thinking_level TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, model TEXT NOT NULL,
      thinking_level TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL,
      session_file TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_project_status ON sessions(project, status);
    CREATE TABLE assignments (
      task_id TEXT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (task_id, session_id, role)
    );
    CREATE INDEX assignments_session ON assignments(session_id);
    CREATE TABLE reports (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE reports_fts USING fts5(report_id UNINDEXED, terms);
    CREATE TABLE note_reads (
      note_id TEXT NOT NULL, session_id TEXT NOT NULL, read_at INTEGER NOT NULL,
      PRIMARY KEY (note_id, session_id)
    );
    CREATE TABLE orchestrator_state (project TEXT PRIMARY KEY, max_concurrent_sessions INTEGER);
    INSERT INTO tasks VALUES ('t-1', 'p', 'main', 'work', 'port the parser', 'old parser',
      'new parser', 'completed', '/repo', NULL, NULL, NULL, 1, 2);
    INSERT INTO sessions VALUES ('s-1', 'p', 'fast/flash', 'low', '/repo', 'completed',
      '/repo/worker.jsonl', 1, 2);
    INSERT INTO assignments VALUES ('t-1', 's-1', 'worker', 1);
    INSERT INTO reports VALUES ('rep-1', 't-1', 's-1', 'worker', 'completed', 'parser ported', 2);
    INSERT INTO reports_fts VALUES ('rep-1', 'parser ported');
    INSERT INTO note_reads VALUES ('note-1', 's-1', 2);
    INSERT INTO orchestrator_state VALUES ('p', 3);
  `);
  legacy.close();
  return path;
}

it("carries the threads, their assignments, reports, read notes, and limit over from sessions", () => {
  const database = store.openDatabase(legacyDatabase());

  expect(store.getThread(database, "s-1")).toMatchObject({
    model: "fast/flash",
    status: "completed",
    sessionFile: "/repo/worker.jsonl",
  });
  expect(store.assignmentsOfThread(database, "s-1")).toEqual([
    { taskId: "t-1", threadId: "s-1", role: "worker", createdAt: 1 },
  ]);
  expect(store.searchReports(database, "p", "parser", 10)).toMatchObject([
    { report: { id: "rep-1", threadId: "s-1" }, threadModel: "fast/flash" },
  ]);
  expect(store.noteRead(database, "note-1", "s-1")).toBe(true);
  expect(store.storedMaxConcurrent(database, "p")).toBe(3);
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%session%'")
    .all();
  expect(tables).toEqual([]);
  database.close();
});

it("opens a migrated database again without changing it", () => {
  const path = legacyDatabase();
  store.openDatabase(path).close();
  const database = store.openDatabase(path);
  expect(store.listThreads(database, "p").map((thread) => thread.id)).toEqual(["s-1"]);
  database.close();
});

it("opens a migrated database that an older msa reopened and gave an empty sessions table", () => {
  const path = legacyDatabase();
  store.openDatabase(path).close();
  const older = new DatabaseSync(path);
  older.exec(`
    PRAGMA user_version = 0;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project TEXT NOT NULL, model TEXT NOT NULL,
      thinking_level TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL,
      session_file TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_project_status ON sessions(project, status);
    INSERT INTO sessions VALUES ('s-2', 'p', 'fast/flash', 'low', '/repo', 'running', NULL, 3, 3);
  `);
  older.close();

  const database = store.openDatabase(path);

  expect(store.listThreads(database, "p").map((thread) => thread.id)).toEqual(["s-1", "s-2"]);
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%session%'")
    .all();
  expect(tables).toEqual([]);
  database.close();
});

it("refuses a database written by a newer msa and leaves it untouched", () => {
  const path = legacyDatabase();
  const newer = new DatabaseSync(path);
  newer.exec("PRAGMA user_version = 99");
  newer.close();

  expect(() => store.openDatabase(path)).toThrow("Update msa");

  const untouched = new DatabaseSync(path);
  const tables = untouched
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
    .all();
  expect(tables).toEqual([]);
  untouched.close();
});
