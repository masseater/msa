import type DatabaseSync from "../platform/node/sqlite.ts";
import dbModule from "./db.ts";
import type watchdogTypes from "./watchdog.types.ts";

const { db } = dbModule;

function deadOwnerProjects(
  database: DatabaseSync,
  project: string,
): { project: string; ownerPid: number }[] {
  const rows = database
    .prepare(
      `SELECT s.project, s.owner_pid FROM orchestrator_state s
       WHERE s.project != ? AND s.owner_pid IS NOT NULL AND EXISTS (
         SELECT 1 FROM threads t WHERE t.project = s.project AND t.status = 'running')`,
    )
    .all(project) as unknown as { project: string; owner_pid: number }[];
  return rows.map((row) => ({ ownerPid: row.owner_pid, project: row.project }));
}

function runningTasksWithoutThread(database: DatabaseSync, project: string): string[] {
  const rows = database
    .prepare(
      `SELECT id FROM tasks WHERE project = ? AND status = 'running' AND NOT EXISTS (
         SELECT 1 FROM assignments a JOIN threads th ON th.id = a.thread_id
         WHERE a.task_id = tasks.id AND th.status = 'running')
         AND NOT EXISTS (SELECT 1 FROM provider_waits w WHERE w.task_id = tasks.id)
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

function releaseProject(database: DatabaseSync, project: string, pid: number): void {
  database
    .prepare("UPDATE orchestrator_state SET owner_pid = NULL WHERE project = ? AND owner_pid = ?")
    .run(project, pid);
}

function recoverProject(database: DatabaseSync, project: string, cause: string, now: number): void {
  db.transaction(database, () => {
    const tasks = database
      .prepare(
        "SELECT id, title, updated_at FROM tasks WHERE project = ? AND status = 'running' ORDER BY created_at, id",
      )
      .all(project) as unknown as { id: string; title: string; updated_at: number }[];
    const notice = database.prepare(
      `INSERT OR REPLACE INTO recovery_notices (task_id, project, title, cause, last_update, recovered_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const task of tasks) notice.run(task.id, project, task.title, cause, task.updated_at, now);
    database
      .prepare(
        "UPDATE threads SET status = 'stopped', updated_at = ? WHERE project = ? AND status = 'running'",
      )
      .run(now, project);
    database
      .prepare(
        "UPDATE tasks SET status = CASE WHEN closed_by IS NULL THEN 'waiting' ELSE 'stopped' END, updated_at = ? WHERE project = ? AND status = 'running'",
      )
      .run(now, project);
  });
}

function takeRecoveryNotices(
  database: DatabaseSync,
  project: string,
): watchdogTypes.RecoveryNotice[] {
  return db.transaction(database, () => {
    const rows = database
      .prepare(
        "SELECT * FROM recovery_notices WHERE project = ? ORDER BY recovered_at, last_update, task_id",
      )
      .all(project) as unknown as {
      task_id: string;
      title: string;
      cause: string;
      last_update: number;
      recovered_at: number;
    }[];
    database.prepare("DELETE FROM recovery_notices WHERE project = ?").run(project);
    return rows.map((row) => ({
      cause: row.cause,
      lastUpdate: row.last_update,
      recoveredAt: row.recovered_at,
      taskId: row.task_id,
      title: row.title,
    }));
  });
}

const watchdogStore = {
  claimProject,
  deadOwnerProjects,
  recoverProject,
  releaseProject,
  runningTasksWithoutThread,
  takeRecoveryNotices,
};

export default watchdogStore;
