import type DatabaseSync from "../platform/node/sqlite.ts";
import providerWaitText from "./provider-wait-text.ts";
import textModule from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { segmentWords } = textModule;

const PROVIDER_WAITS_TABLE = `
CREATE TABLE IF NOT EXISTS provider_waits (
  task_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  session_file TEXT,
  reason TEXT NOT NULL,
  error TEXT NOT NULL,
  resume_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);`;

const PROVIDER_WAIT_SCHEMA = `${PROVIDER_WAITS_TABLE}
CREATE TABLE IF NOT EXISTS provider_resumes (
  task_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL
);
`;

interface UndatedWait {
  task_id: string;
  thread_id: string;
  role: string;
  reason: orchestratorTypesTypes.ProviderWait["reason"];
  error: string;
  created_at: number;
}

function moveToDecision(database: DatabaseSync, wait: UndatedWait): void {
  const id = `rep-${wait.thread_id}-${wait.role}-provider-stall`;
  const content = providerWaitText.stallText(wait.reason, wait.error);
  database
    .prepare(
      `INSERT OR IGNORE INTO reports (id, task_id, thread_id, role, status, content, verdict, created_at)
       VALUES (?, ?, ?, ?, 'stopped', ?, NULL, ?)`,
    )
    .run(id, wait.task_id, wait.thread_id, wait.role, content, wait.created_at);
  database
    .prepare("INSERT INTO reports_fts (report_id, terms) VALUES (?, ?)")
    .run(id, segmentWords(content).join(" "));
  database
    .prepare(
      "UPDATE tasks SET status = 'needs-decision', updated_at = ? WHERE id = ? AND status = 'waiting'",
    )
    .run(wait.created_at, wait.task_id);
}

function requireResumeTime(database: DatabaseSync): void {
  const column = (
    database.prepare("PRAGMA table_info(provider_waits)").all() as unknown as {
      name: string;
      notnull: number;
    }[]
  ).find((candidate) => candidate.name === "resume_at");
  if (column === undefined || column.notnull === 1) return;
  database.exec("ALTER TABLE provider_waits RENAME TO provider_waits_nullable");
  database.exec(PROVIDER_WAITS_TABLE);
  database.exec(
    `INSERT INTO provider_waits SELECT task_id, project, thread_id, role, session_file, reason, error, resume_at, created_at
     FROM provider_waits_nullable WHERE resume_at IS NOT NULL`,
  );
  database.exec("DROP TABLE provider_waits_nullable");
}

function moveUndatedWaits(database: DatabaseSync): void {
  const undated = database
    .prepare(
      "SELECT task_id, thread_id, role, reason, error, created_at FROM provider_waits WHERE resume_at IS NULL",
    )
    .all() as unknown as UndatedWait[];
  for (const wait of undated) moveToDecision(database, wait);
  database.prepare("DELETE FROM provider_waits WHERE resume_at IS NULL").run();
  requireResumeTime(database);
}

const providerWaitSchema = { PROVIDER_WAIT_SCHEMA, moveUndatedWaits };

export default providerWaitSchema;
