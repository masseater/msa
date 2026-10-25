import type DatabaseSync from "../platform/node/sqlite.ts";
import triageAskStore from "./triage-ask-store.ts";
import type triageTypes from "./triage.types.ts";
import type worktreeSnapshotTypes from "./worktree-snapshot.types.ts";

const REVIEW_CONTENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS review_contents (
  task_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  root TEXT NOT NULL,
  tree TEXT
);
`;

type Snapshot = worktreeSnapshotTypes.Snapshot;

interface ReviewContentsRow {
  snapshot_id: string;
  root: string;
  tree: string | null;
}

function reviewContentsOf(database: DatabaseSync, taskId: string): Snapshot | undefined {
  const row = database
    .prepare("SELECT snapshot_id, root, tree FROM review_contents WHERE task_id = ?")
    .get(taskId) as ReviewContentsRow | undefined;
  return row === undefined
    ? undefined
    : { id: row.snapshot_id, root: row.root, tree: row.tree ?? undefined };
}

function saveReviewContents(
  database: DatabaseSync,
  taskId: string,
  contents: Snapshot | undefined,
): void {
  if (contents === undefined) {
    database.prepare("DELETE FROM review_contents WHERE task_id = ?").run(taskId);
    return;
  }
  database
    .prepare(
      `INSERT INTO review_contents (task_id, snapshot_id, root, tree) VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET snapshot_id = excluded.snapshot_id, root = excluded.root, tree = excluded.tree`,
    )
    .run(taskId, contents.id, contents.root, contents.tree ?? null);
}

const TRIAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS triage_decisions (
  task_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  contents_id TEXT,
  request TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS triage_decisions_task ON triage_decisions(task_id, created_at);
`;

type TriageDecision = triageTypes.Decision;

function askKey(text: string): string {
  return text.toLowerCase().replaceAll(/\s+/gu, " ").trim();
}

interface TriageDecisionRow {
  request_key: string;
  contents_id: string | null;
  request: string;
  decision: string;
}

function triageDecisionsOf(database: DatabaseSync, taskId: string): TriageDecision[] {
  const rows = database
    .prepare(
      "SELECT request_key, contents_id, request, decision FROM triage_decisions WHERE task_id = ? ORDER BY created_at",
    )
    .all(taskId) as unknown as TriageDecisionRow[];
  return rows.map((row) => ({
    contentsId: row.contents_id,
    decision: row.decision,
    request: row.request,
    requestKey: row.request_key,
  }));
}

function addTriageDecisionText(database: DatabaseSync): void {
  const rows = database.prepare("PRAGMA table_info(triage_decisions)").all() as unknown as {
    name: string;
  }[];
  const names = new Set(rows.map((row) => row.name));
  for (const column of ["request", "decision"]) {
    if (!names.has(column)) {
      database.exec(`ALTER TABLE triage_decisions ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
  }
}

function saveTriageDecision(
  database: DatabaseSync,
  taskId: string,
  decision: TriageDecision,
  now: number,
): void {
  database
    .prepare(
      "INSERT INTO triage_decisions (task_id, request_key, contents_id, request, decision, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      taskId,
      decision.requestKey,
      decision.contentsId,
      decision.request,
      decision.decision,
      now,
    );
}

const PROGRESS_SCHEMA = `${REVIEW_CONTENTS_SCHEMA}\n${TRIAGE_SCHEMA}\n${triageAskStore.TRIAGE_ASK_SCHEMA}`;

const progressStore = {
  PROGRESS_SCHEMA,
  addTriageDecisionText,
  askKey,
  hasTriageAsk: triageAskStore.hasTriageAsk,
  moveTriageAsk: triageAskStore.moveTriageAsk,
  reviewContentsOf,
  saveReviewContents,
  saveTriageAsk: triageAskStore.saveTriageAsk,
  saveTriageDecision,
  stoppedReadOnlyCheckouts: triageAskStore.stoppedReadOnlyCheckouts,
  takePendingTriageAsks: triageAskStore.takePendingTriageAsks,
  takeTriageAsk: triageAskStore.takeTriageAsk,
  triageDecisionsOf,
};

export default progressStore;
