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
    after: JSON.parse(row.after_state) as ReplanChanges,
    createdAt: row.created_at,
    id: row.id,
    project: row.project,
    reason: row.reason,
  };
}

function toView(record: ReplanRecord): ReplanView {
  return {
    created: record.after.created,
    createdAt: record.createdAt,
    dropped: record.after.dropped,
    id: record.id,
    kept: record.after.kept,
    reason: record.reason,
    rewired: record.after.rewired,
    stopped: record.after.stopped,
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
