const PROVIDER_WAIT_SCHEMA = `
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
);
`;

const providerWaitSchema = { PROVIDER_WAIT_SCHEMA };

export default providerWaitSchema;
