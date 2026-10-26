import type DatabaseSync from "../platform/node/sqlite.ts";

interface ReplanRecord {
  created?: { taskId: string; from?: string[] }[];
  dropped?: { taskId: string }[];
}

interface Replacements {
  heirs: Map<string, string[]>;
  closedBy: Map<string, string>;
}

function replacements(database: DatabaseSync): Replacements {
  const rows = database
    .prepare("SELECT id, after_state FROM replans ORDER BY created_at, id")
    .all() as unknown as { id: string; after_state: string }[];
  const heirs = new Map<string, string[]>();
  const closedBy = new Map<string, string>();
  for (const row of rows) {
    const record = JSON.parse(row.after_state) as ReplanRecord;
    for (const created of record.created ?? []) {
      for (const source of created.from ?? []) {
        heirs.set(source, [...(heirs.get(source) ?? []), created.taskId]);
        closedBy.set(source, row.id);
      }
    }
    for (const dropped of record.dropped ?? []) closedBy.set(dropped.taskId, row.id);
  }
  return { closedBy, heirs };
}

function isClosed(database: DatabaseSync, id: string): boolean {
  const row = database
    .prepare("SELECT 1 AS found FROM tasks WHERE id = ? AND closed_by IS NOT NULL")
    .get(id);
  return row !== undefined;
}

function dependenciesOf(database: DatabaseSync, id: string): string[] {
  const rows = database
    .prepare("SELECT depends_on FROM task_dependencies WHERE task_id = ?")
    .all(id) as unknown as { depends_on: string }[];
  return rows.map((row) => row.depends_on);
}

function successors(
  database: DatabaseSync,
  heirs: ReadonlyMap<string, readonly string[]>,
  id: string,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const next = heirs.get(id) ?? dependenciesOf(database, id);
  return next.flatMap((candidate) =>
    isClosed(database, candidate) ? successors(database, heirs, candidate, seen) : [candidate],
  );
}

function reaches(database: DatabaseSync, from: string, target: string): boolean {
  const row = database
    .prepare(
      `WITH RECURSIVE reach(id) AS (
         SELECT ?
         UNION
         SELECT d.depends_on FROM task_dependencies d JOIN reach r ON d.task_id = r.id
       )
       SELECT 1 AS found FROM reach WHERE id = ? LIMIT 1`,
    )
    .get(from, target);
  return row !== undefined;
}

function settleClosed(database: DatabaseSync): void {
  const settled = database
    .prepare(
      `UPDATE tasks SET status = 'stopped' WHERE closed_by IS NOT NULL AND status <> 'stopped'
         RETURNING id`,
    )
    .all() as unknown as { id: string }[];
  const clearWait = database.prepare("DELETE FROM provider_waits WHERE task_id = ?");
  for (const row of settled) clearWait.run(row.id);
  database.exec(
    `UPDATE threads SET status = 'stopped' WHERE status = 'running'
       AND EXISTS (SELECT 1 FROM assignments a WHERE a.thread_id = threads.id)
       AND NOT EXISTS (
         SELECT 1 FROM assignments a JOIN tasks t ON t.id = a.task_id
         WHERE a.thread_id = threads.id AND t.closed_by IS NULL)`,
  );
}

function closeReplacedTasks(database: DatabaseSync): void {
  const { closedBy, heirs } = replacements(database);
  const close = database.prepare(
    "UPDATE tasks SET closed_by = ? WHERE id = ? AND closed_by IS NULL",
  );
  for (const [id, replanId] of closedBy) close.run(replanId, id);
  settleClosed(database);
  const waitedOn = database
    .prepare(
      `SELECT DISTINCT d.depends_on FROM task_dependencies d
       JOIN tasks c ON c.id = d.depends_on JOIN tasks t ON t.id = d.task_id
       WHERE c.closed_by IS NOT NULL AND t.status <> 'completed' AND t.closed_by IS NULL
       ORDER BY d.depends_on`,
    )
    .all() as unknown as { depends_on: string }[];
  const dependents = database.prepare(
    `SELECT d.task_id, t.kind FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
     WHERE d.depends_on = ? AND t.status <> 'completed'
       AND t.closed_by IS NULL`,
  );
  const remove = database.prepare(
    "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?",
  );
  const add = database.prepare(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
  );
  for (const { depends_on: source } of waitedOn) {
    const rows = dependents.all(source) as unknown as { task_id: string; kind: string }[];
    for (const row of rows) {
      remove.run(row.task_id, source);
      if (row.kind === "review") continue;
      for (const heir of successors(database, heirs, source)) {
        if (heir === row.task_id || reaches(database, heir, row.task_id)) continue;
        add.run(row.task_id, heir);
      }
    }
  }
}

const closedMigration = { closeReplacedTasks };

export default closedMigration;
