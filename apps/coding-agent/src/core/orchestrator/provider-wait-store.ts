import type DatabaseSync from "../platform/node/sqlite.ts";
import type orchestratorTypesTypes from "./types.types.ts";

interface ProviderWaitRow {
  task_id: string;
  project: string;
  thread_id: string;
  role: string;
  session_file: string | null;
  reason: string;
  error: string;
  resume_at: number;
  created_at: number;
}

function toWait(row: ProviderWaitRow): orchestratorTypesTypes.ProviderWait {
  return {
    createdAt: row.created_at,
    error: row.error,
    project: row.project,
    reason: row.reason as orchestratorTypesTypes.ProviderWait["reason"],
    resumeAt: row.resume_at,
    role: row.role as orchestratorTypesTypes.ThreadRole,
    sessionFile: row.session_file,
    taskId: row.task_id,
    threadId: row.thread_id,
  };
}

function insertProviderWait(
  database: DatabaseSync,
  wait: orchestratorTypesTypes.ProviderWait,
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO provider_waits
         (task_id, project, thread_id, role, session_file, reason, error, resume_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      wait.taskId,
      wait.project,
      wait.threadId,
      wait.role,
      wait.sessionFile,
      wait.reason,
      wait.error,
      wait.resumeAt,
      wait.createdAt,
    );
}

function listProviderWaits(
  database: DatabaseSync,
  project: string,
): orchestratorTypesTypes.ProviderWait[] {
  const rows = database
    .prepare("SELECT * FROM provider_waits WHERE project = ? ORDER BY resume_at, task_id")
    .all(project) as unknown as ProviderWaitRow[];
  return rows.map(toWait);
}

function deleteProviderWait(database: DatabaseSync, taskId: string): void {
  database.prepare("DELETE FROM provider_waits WHERE task_id = ?").run(taskId);
}

const providerWaitStore = { deleteProviderWait, insertProviderWait, listProviderWaits };

export default providerWaitStore;
