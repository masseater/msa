import type { DatabaseSync } from "node:sqlite";

import dbModule from "./db.ts";
import taskRows from "./task-rows.ts";
import type taskStoreInternalTypes from "./task-store-internal.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { db } = dbModule;
const { toTask, getTask } = taskRows;

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

function clearDependencies(database: DatabaseSync, taskId: string): void {
  database.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId);
}

function readyTasks(
  database: DatabaseSync,
  project: string,
  kind: orchestratorTypesTypes.TaskKind,
): orchestratorTypesTypes.Task[] {
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
    .all(project, kind) as unknown as taskStoreInternalTypes.TaskRow[];
  return rows.map(toTask);
}

function tasksWithCondition(
  database: DatabaseSync,
  project: string,
): orchestratorTypesTypes.Task[] {
  const rows = database
    .prepare(
      `SELECT * FROM tasks WHERE project = ? AND status = 'waiting' AND kind = 'work'
         AND condition IS NOT NULL AND condition <> '' ORDER BY created_at, id`,
    )
    .all(project) as unknown as taskStoreInternalTypes.TaskRow[];
  return rows.map(toTask);
}

const taskDependencies = {
  addDependency,
  clearDependencies,
  dependenciesOf,
  dependentsOf,
  listDependencyPairs,
  readyTasks,
  removeDependency,
  replaceDependencies,
  tasksWithCondition,
  unfinishedDependencies,
};

export default taskDependencies;
