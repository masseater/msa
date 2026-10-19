import type { DatabaseSync } from "node:sqlite";

import type { ReplanChanges, ReplanRecord, ReplanView } from "./types.ts";

interface ReplanRow {
  id: string;
  project: string;
  reason: string;
  after_state: string;
  created_at: number;
}

function toRecord(row: ReplanRow): ReplanRecord {
  return {
    id: row.id,
    project: row.project,
    reason: row.reason,
    after: JSON.parse(row.after_state) as ReplanChanges,
    createdAt: row.created_at,
  };
}

function toView(record: ReplanRecord): ReplanView {
  return {
    id: record.id,
    reason: record.reason,
    createdAt: record.createdAt,
    stopped: record.after.stopped,
    created: record.after.created,
    dropped: record.after.dropped,
    kept: record.after.kept,
    rewired: record.after.rewired,
  };
}

function insertReplan(database: DatabaseSync, record: ReplanRecord): void {
  database
    .prepare(
      `INSERT INTO replans (id, project, reason, after_state, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(record.id, record.project, record.reason, JSON.stringify(record.after), record.createdAt);
}

function listReplans(database: DatabaseSync, project: string, limit: number): ReplanView[] {
  const rows = database
    .prepare("SELECT * FROM replans WHERE project = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(project, limit) as unknown as ReplanRow[];
  return rows.map((row) => toView(toRecord(row)));
}

export const replanStore = {
  insertReplan,
  listReplans,
};
