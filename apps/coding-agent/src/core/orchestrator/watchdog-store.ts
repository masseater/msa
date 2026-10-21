import type DatabaseSync from "../platform/node/sqlite.ts";

function runningThreadsElsewhere(
  database: DatabaseSync,
  project: string,
): { threadId: string; ownerPid: number | null }[] {
  const rows = database
    .prepare(
      `SELECT t.id, s.owner_pid FROM threads t
       LEFT JOIN orchestrator_state s ON s.project = t.project
       WHERE t.project != ? AND t.status = 'running'`,
    )
    .all(project) as unknown as { id: string; owner_pid: number | null }[];
  return rows.map((row) => ({ ownerPid: row.owner_pid, threadId: row.id }));
}

function runningTasksWithoutThread(database: DatabaseSync, project: string): string[] {
  const rows = database
    .prepare(
      `SELECT id FROM tasks WHERE project = ? AND status = 'running' AND NOT EXISTS (
         SELECT 1 FROM assignments a JOIN threads th ON th.id = a.thread_id
         WHERE a.task_id = tasks.id AND th.status = 'running')
       ORDER BY created_at, id`,
    )
    .all(project) as unknown as { id: string }[];
  return rows.map((row) => row.id);
}

function claimProject(database: DatabaseSync, project: string, pid: number): void {
  database
    .prepare(
      `INSERT INTO orchestrator_state (project, owner_pid) VALUES (?, ?)
       ON CONFLICT(project) DO UPDATE SET owner_pid = excluded.owner_pid`,
    )
    .run(project, pid);
}

const watchdogStore = { claimProject, runningTasksWithoutThread, runningThreadsElsewhere };

export default watchdogStore;
