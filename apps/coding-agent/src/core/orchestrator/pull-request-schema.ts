import type DatabaseSync from "../platform/node/sqlite.ts";

const PULL_REQUEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS task_pull_requests (
  task_id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  branch TEXT NOT NULL,
  base TEXT NOT NULL,
  state TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  ci TEXT NOT NULL,
  mergeable TEXT NOT NULL,
  merge_state TEXT NOT NULL,
  verified_sha TEXT,
  verified_title TEXT,
  verified_body TEXT,
  merge_commit TEXT,
  harness_merge_sha TEXT,
  blocked_head TEXT,
  harness_merge_commit TEXT,
  harness_merge_nonce TEXT,
  checked_at INTEGER NOT NULL
);
`;

const ADDED_COLUMNS = [
  "merge_commit",
  "harness_merge_sha",
  "harness_merge_commit",
  "harness_merge_nonce",
  "blocked_head",
] as const;

function addPullRequestColumns(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(task_pull_requests)").all() as unknown as {
    name: string;
  }[];
  const names = new Set(columns.map((column) => column.name));
  for (const column of ADDED_COLUMNS) {
    if (!names.has(column)) {
      database.exec(`ALTER TABLE task_pull_requests ADD COLUMN ${column} TEXT`);
    }
  }
}

const pullRequestSchema = { PULL_REQUEST_SCHEMA, addPullRequestColumns };

export default pullRequestSchema;
