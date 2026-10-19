import type { DatabaseSync } from "node:sqlite";

function storedMaxConcurrent(database: DatabaseSync, project: string): number | null {
  const row = database
    .prepare("SELECT max_concurrent_threads FROM orchestrator_state WHERE project = ?")
    .get(project) as { max_concurrent_threads: number | null } | undefined;
  return row?.max_concurrent_threads ?? null;
}

function storeMaxConcurrent(database: DatabaseSync, project: string, value: number): void {
  database
    .prepare(
      `INSERT INTO orchestrator_state (project, max_concurrent_threads) VALUES (?, ?)
       ON CONFLICT(project) DO UPDATE SET max_concurrent_threads = excluded.max_concurrent_threads`,
    )
    .run(project, value);
}

export const stateStore = { storedMaxConcurrent, storeMaxConcurrent };

function recoverRunning(database: DatabaseSync, project: string, now: number): void {
  database
    .prepare(
      "UPDATE threads SET status = 'stopped', updated_at = ? WHERE project = ? AND status = 'running'",
    )
    .run(now, project);
  database
    .prepare(
      "UPDATE tasks SET status = 'waiting', updated_at = ? WHERE project = ? AND status = 'running'",
    )
    .run(now, project);
}

export const recovery = { recoverRunning };
