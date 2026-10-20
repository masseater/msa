import type { DatabaseSync } from "node:sqlite";

import { db } from "./db.ts";
import type { Task, TaskKind, TaskStatus } from "./types.ts";

interface TaskRow {
  id: string;
  project: string;
  round: string;
  kind: string;
  title: string;
  current_state: string;
  goal_state: string;
  status: string;
  cwd: string;
  condition: string | null;
  model: string | null;
  thinking_level: string | null;
  created_at: number;
  updated_at: number;
}

function toTask(row: TaskRow): Task {
  return {
    condition: row.condition,
    createdAt: row.created_at,
    currentState: row.current_state,
    cwd: row.cwd,
    goalState: row.goal_state,
    id: row.id,
    kind: row.kind as TaskKind,
    model: row.model,
    project: row.project,
    round: row.round,
    status: row.status as TaskStatus,
    thinkingLevel: row.thinking_level as Task["thinkingLevel"],
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function insertTask(database: DatabaseSync, task: Task): void {
  database
    .prepare(
      `INSERT INTO tasks (id, project, round, kind, title, current_state, goal_state, status, cwd,
         condition, model, thinking_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.project,
      task.round,
      task.kind,
      task.title,
      task.currentState,
      task.goalState,
      task.status,
      task.cwd,
      task.condition,
      task.model,
      task.thinkingLevel,
      task.createdAt,
      task.updatedAt,
    );
}

function getTask(database: DatabaseSync, id: string): Task | undefined {
  const row = database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row === undefined ? undefined : toTask(row);
}

function listTasks(database: DatabaseSync, project: string): Task[] {
  const rows = database
    .prepare("SELECT * FROM tasks WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as TaskRow[];
  return rows.map(toTask);
}

const PATCH_COLUMNS: Readonly<Record<string, string>> = {
  condition: "condition",
  currentState: "current_state",
  goalState: "goal_state",
  model: "model",
  status: "status",
  thinkingLevel: "thinking_level",
  title: "title",
};

function updateTask(
  database: DatabaseSync,
  id: string,
  patch: Partial<
    Pick<
      Task,
      "title" | "currentState" | "goalState" | "status" | "condition" | "model" | "thinkingLevel"
    >
  >,
  now: number,
): void {
  const entries = db
    .definedEntries(patch)
    .map(([key, value]) => [PATCH_COLUMNS[key] ?? key, value]) as [
    string,
    string | number | null,
  ][];
  if (entries.length === 0) return;
  const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
  database
    .prepare(`UPDATE tasks SET ${assignments}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value), now, id);
}

function setTaskStatus(database: DatabaseSync, id: string, status: TaskStatus, now: number): void {
  updateTask(database, id, { status }, now);
}

function dependenciesOf(database: DatabaseSync, taskId: string): string[] {
  const rows = database
    .prepare("SELECT depends_on FROM task_dependencies WHERE task_id = ? ORDER BY depends_on")
    .all(taskId) as unknown as { depends_on: string }[];
  return rows.map((row) => row.depends_on);
}

function dependentsOf(database: DatabaseSync, taskId: string): string[] {
  const rows = database
    .prepare("SELECT task_id FROM task_dependencies WHERE depends_on = ? ORDER BY task_id")
    .all(taskId) as unknown as { task_id: string }[];
  return rows.map((row) => row.task_id);
}

function listDependencyPairs(
  database: DatabaseSync,
  project: string,
): { taskId: string; dependsOn: string }[] {
  const rows = database
    .prepare(
      `SELECT d.task_id, d.depends_on FROM task_dependencies d
       JOIN tasks t ON t.id = d.task_id WHERE t.project = ?`,
    )
    .all(project) as unknown as { task_id: string; depends_on: string }[];
  return rows.map((row) => ({ dependsOn: row.depends_on, taskId: row.task_id }));
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

function addDependency(
  database: DatabaseSync,
  project: string,
  taskId: string,
  dependsOn: string,
): void {
  if (taskId === dependsOn) throw new Error(`${taskId} cannot depend on itself`);
  const task = getTask(database, taskId);
  const dependency = getTask(database, dependsOn);
  if (task === undefined || task.project !== project) throw new Error(`Unknown task: ${taskId}`);
  if (dependency === undefined || dependency.project !== project) {
    throw new Error(`Unknown task: ${dependsOn}`);
  }
  if (reaches(database, dependsOn, taskId)) {
    throw new Error(`Adding ${dependsOn} to ${taskId} would make a dependency cycle`);
  }
  database
    .prepare("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)")
    .run(taskId, dependsOn);
}

function removeDependency(database: DatabaseSync, taskId: string, dependsOn: string): void {
  database
    .prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?")
    .run(taskId, dependsOn);
}

function replaceDependencies(
  database: DatabaseSync,
  project: string,
  taskId: string,
  dependsOn: readonly string[],
): void {
  db.transaction(database, () => {
    database.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId);
    for (const dependency of dependsOn) {
      addDependency(database, project, taskId, dependency);
    }
  });
}

function unfinishedDependencies(database: DatabaseSync, taskId: string): string[] {
  const rows = database
    .prepare(
      `SELECT d.depends_on FROM task_dependencies d
       JOIN tasks dep ON dep.id = d.depends_on
       WHERE d.task_id = ? AND dep.status <> 'completed' ORDER BY d.depends_on`,
    )
    .all(taskId) as unknown as { depends_on: string }[];
  return rows.map((row) => row.depends_on);
}

function readyTasks(database: DatabaseSync, project: string, kind: TaskKind): Task[] {
  const rows = database
    .prepare(
      `SELECT t.* FROM tasks t
       WHERE t.project = ? AND t.status = 'waiting' AND t.kind = ?
         AND (t.condition IS NULL OR t.condition = '')
         AND NOT EXISTS (
           SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on
           WHERE d.task_id = t.id AND dep.status <> 'completed'
         )
       ORDER BY t.created_at, t.id`,
    )
    .all(project, kind) as unknown as TaskRow[];
  return rows.map(toTask);
}

function tasksWithCondition(database: DatabaseSync, project: string): Task[] {
  const rows = database
    .prepare(
      `SELECT * FROM tasks WHERE project = ? AND status = 'waiting' AND kind = 'work'
         AND condition IS NOT NULL AND condition <> '' ORDER BY created_at, id`,
    )
    .all(project) as unknown as TaskRow[];
  return rows.map(toTask);
}

function insertRound(
  database: DatabaseSync,
  project: string,
  id: string,
  title: string,
  now: number,
): void {
  database
    .prepare("INSERT OR IGNORE INTO rounds (id, project, title, created_at) VALUES (?, ?, ?, ?)")
    .run(id, project, title, now);
}

function listRoundIds(database: DatabaseSync, project: string): { id: string; title: string }[] {
  return database
    .prepare("SELECT id, title FROM rounds WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as { id: string; title: string }[];
}

function reviewTaskOfRound(
  database: DatabaseSync,
  project: string,
  round: string,
): Task | undefined {
  const row = database
    .prepare("SELECT * FROM tasks WHERE project = ? AND round = ? AND kind = 'review' LIMIT 1")
    .get(project, round) as TaskRow | undefined;
  return row === undefined ? undefined : toTask(row);
}

function workTasksOfRound(database: DatabaseSync, project: string, round: string): Task[] {
  const rows = database
    .prepare(
      "SELECT * FROM tasks WHERE project = ? AND round = ? AND kind = 'work' ORDER BY created_at, id",
    )
    .all(project, round) as unknown as TaskRow[];
  return rows.map(toTask);
}

function clearDependencies(database: DatabaseSync, taskId: string): void {
  database.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId);
}

function deleteTask(database: DatabaseSync, taskId: string): void {
  database
    .prepare("DELETE FROM task_dependencies WHERE task_id = ? OR depends_on = ?")
    .run(taskId, taskId);
  database.prepare("DELETE FROM assignments WHERE task_id = ?").run(taskId);
  database.prepare("DELETE FROM reports WHERE task_id = ?").run(taskId);
  database.prepare("DELETE FROM note_targets WHERE task_id = ?").run(taskId);
  database.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
}

export const taskStore = {
  addDependency,
  clearDependencies,
  deleteTask,
  dependenciesOf,
  dependentsOf,
  getTask,
  insertRound,
  insertTask,
  listDependencyPairs,
  listRoundIds,
  listTasks,
  readyTasks,
  removeDependency,
  replaceDependencies,
  reviewTaskOfRound,
  setTaskStatus,
  tasksWithCondition,
  unfinishedDependencies,
  updateTask,
  workTasksOfRound,
};
