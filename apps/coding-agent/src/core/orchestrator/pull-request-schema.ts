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
  checked_at INTEGER NOT NULL
);
`;

const pullRequestSchema = { PULL_REQUEST_SCHEMA };

export default pullRequestSchema;
