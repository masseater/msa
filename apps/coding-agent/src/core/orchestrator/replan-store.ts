import type { DatabaseSync } from "node:sqlite";

import { store } from "./store.ts";
import type { ReplanChanges, ReplanRecord, ReplanState, ReplanView } from "./types.ts";

interface ReplanRow {
  id: string;
  project: string;
  reason: string;
  before_state: string;
  after_state: string;
  created_at: number;
  undone_at: number | null;
}

function toRecord(row: ReplanRow): ReplanRecord {
  return {
    id: row.id,
    project: row.project,
    reason: row.reason,
    before: JSON.parse(row.before_state) as ReplanState,
    after: JSON.parse(row.after_state) as ReplanChanges,
    createdAt: row.created_at,
    undoneAt: row.undone_at,
  };
}

function toView(record: ReplanRecord): ReplanView {
  return {
    id: record.id,
    reason: record.reason,
    createdAt: record.createdAt,
    undoneAt: record.undoneAt,
    stopped: record.after.stopped,
    created: record.after.created,
    dropped: record.after.dropped,
    kept: record.after.kept,
    rewired: record.after.rewired,
  };
}

function captureState(
  database: DatabaseSync,
  project: string,
  maxConcurrentSessions: number,
): ReplanState {
  return {
    maxConcurrentSessions,
    tasks: store.listTasks(database, project).map((task) => ({
      id: task.id,
      status: task.status,
      dependsOn: store.dependenciesOf(database, task.id),
    })),
    rounds: store.listRoundIds(database, project),
    sessions: store.listSessions(database, project).map((session) => session.id),
  };
}

function insertReplan(database: DatabaseSync, record: ReplanRecord): void {
  database
    .prepare(
      `INSERT INTO replans (id, project, reason, before_state, after_state, created_at, undone_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.project,
      record.reason,
      JSON.stringify(record.before),
      JSON.stringify(record.after),
      record.createdAt,
      record.undoneAt,
    );
}

function latestOpen(database: DatabaseSync, project: string): ReplanRecord | undefined {
  const row = database
    .prepare(
      "SELECT * FROM replans WHERE project = ? AND undone_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(project) as ReplanRow | undefined;
  return row === undefined ? undefined : toRecord(row);
}

function latest(database: DatabaseSync, project: string): ReplanRecord | undefined {
  const row = database
    .prepare("SELECT * FROM replans WHERE project = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(project) as ReplanRow | undefined;
  return row === undefined ? undefined : toRecord(row);
}

function listReplans(database: DatabaseSync, project: string, limit: number): ReplanView[] {
  const rows = database
    .prepare("SELECT * FROM replans WHERE project = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(project, limit) as unknown as ReplanRow[];
  return rows.map((row) => toView(toRecord(row)));
}

function markUndone(database: DatabaseSync, id: string, now: number): void {
  database.prepare("UPDATE replans SET undone_at = ? WHERE id = ?").run(now, id);
}

export const replanStore = {
  captureState,
  insertReplan,
  latestOpen,
  latest,
  listReplans,
  markUndone,
};
