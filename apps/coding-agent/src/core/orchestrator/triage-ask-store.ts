import type DatabaseSync from "../platform/node/sqlite.ts";
import type triageTypes from "./triage.types.ts";

const TRIAGE_ASK_SCHEMA = `
CREATE TABLE IF NOT EXISTS triage_asks (
  thread_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stopped_thread_id TEXT NOT NULL,
  request TEXT NOT NULL,
  request_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

interface AskRow {
  thread_id: string;
  task_id: string;
  stopped_thread_id: string;
  request: string;
  request_key: string;
  created_at: number;
}

type PendingAsk = triageTypes.PendingAsk;

function toPending(row: AskRow): PendingAsk {
  return {
    ask: {
      key: row.request_key,
      request: row.request,
      taskId: row.task_id,
      threadId: row.stopped_thread_id,
    },
    createdAt: row.created_at,
    triageThreadId: row.thread_id,
  };
}

function saveTriageAsk(
  database: DatabaseSync,
  triageThreadId: string,
  ask: triageTypes.Ask,
  now: number,
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO triage_asks (thread_id, task_id, stopped_thread_id, request, request_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(triageThreadId, ask.taskId, ask.threadId, ask.request, ask.key, now);
}

function takeTriageAsk(
  database: DatabaseSync,
  triageThreadId: string,
): triageTypes.Ask | undefined {
  const row = database
    .prepare("SELECT * FROM triage_asks WHERE thread_id = ?")
    .get(triageThreadId) as AskRow | undefined;
  database.prepare("DELETE FROM triage_asks WHERE thread_id = ?").run(triageThreadId);
  return row === undefined ? undefined : toPending(row).ask;
}

function moveTriageAsk(database: DatabaseSync, from: string, to: string): boolean {
  return (
    Number(
      database.prepare("UPDATE triage_asks SET thread_id = ? WHERE thread_id = ?").run(to, from)
        .changes,
    ) > 0
  );
}

function hasTriageAsk(database: DatabaseSync, triageThreadId: string): boolean {
  return (
    database.prepare("SELECT 1 FROM triage_asks WHERE thread_id = ?").get(triageThreadId) !==
    undefined
  );
}

function takePendingTriageAsks(database: DatabaseSync, project: string): PendingAsk[] {
  const rows = database
    .prepare(
      `SELECT triage_asks.* FROM triage_asks JOIN tasks ON tasks.id = triage_asks.task_id
       WHERE tasks.project = ? ORDER BY triage_asks.created_at, triage_asks.thread_id`,
    )
    .all(project) as unknown as AskRow[];
  const remove = database.prepare("DELETE FROM triage_asks WHERE thread_id = ?");
  for (const row of rows) remove.run(row.thread_id);
  return rows.map(toPending);
}

function stoppedReadOnlyCheckouts(
  database: DatabaseSync,
  project: string,
): triageTypes.ReadOnlyCheckout[] {
  const rows = database
    .prepare(
      `SELECT DISTINCT threads.id AS thread_id, threads.cwd AS cwd, tasks.cwd AS repository
       FROM threads JOIN assignments ON assignments.thread_id = threads.id
       JOIN tasks ON tasks.id = assignments.task_id
       WHERE threads.project = ? AND threads.status != 'running'
         AND assignments.role IN ('advisor', 'triage')`,
    )
    .all(project) as unknown as { thread_id: string; cwd: string; repository: string }[];
  return rows.map((row) => ({ cwd: row.cwd, repository: row.repository, threadId: row.thread_id }));
}

const triageAskStore = {
  TRIAGE_ASK_SCHEMA,
  hasTriageAsk,
  moveTriageAsk,
  saveTriageAsk,
  stoppedReadOnlyCheckouts,
  takePendingTriageAsks,
  takeTriageAsk,
};

export default triageAskStore;
