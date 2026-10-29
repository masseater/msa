import type DatabaseSync from "../platform/node/sqlite.ts";

function columnNames(database: DatabaseSync, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

function addOwnerPid(database: DatabaseSync): void {
  if (columnNames(database, "orchestrator_state").includes("owner_pid")) return;
  database.exec("ALTER TABLE orchestrator_state ADD COLUMN owner_pid INTEGER");
}

function addTaskColumns(database: DatabaseSync): void {
  const tasks = columnNames(database, "tasks");
  if (!tasks.includes("checks")) {
    database.exec("ALTER TABLE tasks ADD COLUMN checks TEXT NOT NULL DEFAULT '[]'");
  }
  if (!tasks.includes("closed_by")) database.exec("ALTER TABLE tasks ADD COLUMN closed_by TEXT");
}

function addWorkspaceColumns(database: DatabaseSync): void {
  const tasks = columnNames(database, "tasks");
  if (!tasks.includes("merge_into")) database.exec("ALTER TABLE tasks ADD COLUMN merge_into TEXT");
  if (!tasks.includes("opens_pull_request")) {
    database.exec("ALTER TABLE tasks ADD COLUMN opens_pull_request INTEGER NOT NULL DEFAULT 1");
  }
  const threads = columnNames(database, "threads");
  if (!threads.includes("branch")) database.exec("ALTER TABLE threads ADD COLUMN branch TEXT");
  if (!threads.includes("target_branch")) {
    database.exec("ALTER TABLE threads ADD COLUMN target_branch TEXT");
  }
}

function addReportVerdict(database: DatabaseSync): void {
  if (columnNames(database, "reports").includes("verdict")) return;
  database.exec("ALTER TABLE reports ADD COLUMN verdict TEXT");
}

function addColumns(database: DatabaseSync): void {
  addOwnerPid(database);
  addTaskColumns(database);
  addWorkspaceColumns(database);
  addReportVerdict(database);
}

const columnMigrations = { addColumns, columnNames };

export default columnMigrations;
