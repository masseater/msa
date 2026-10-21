import type { DatabaseSync } from "node:sqlite";

import dbModule from "./db.ts";
import type taskStoreInternalTypes from "./task-store-internal.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { db } = dbModule;

function toTask(row: taskStoreInternalTypes.TaskRow): orchestratorTypesTypes.Task {
  return {
    condition: row.condition,
    createdAt: row.created_at,
    currentState: row.current_state,
    cwd: row.cwd,
    goalState: row.goal_state,
    id: row.id,
    kind: row.kind as orchestratorTypesTypes.TaskKind,
    model: row.model,
    project: row.project,
    round: row.round,
    status: row.status as orchestratorTypesTypes.TaskStatus,
    thinkingLevel: row.thinking_level as orchestratorTypesTypes.Task["thinkingLevel"],
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function insertTask(database: DatabaseSync, task: orchestratorTypesTypes.Task): void {
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

function getTask(database: DatabaseSync, id: string): orchestratorTypesTypes.Task | undefined {
  const row = database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | taskStoreInternalTypes.TaskRow
    | undefined;
  return row === undefined ? undefined : toTask(row);
}

function listTasks(database: DatabaseSync, project: string): orchestratorTypesTypes.Task[] {
  const rows = database
    .prepare("SELECT * FROM tasks WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as taskStoreInternalTypes.TaskRow[];
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
      orchestratorTypesTypes.Task,
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

function setTaskStatus(
  database: DatabaseSync,
  id: string,
  status: orchestratorTypesTypes.TaskStatus,
  now: number,
): void {
  updateTask(database, id, { status }, now);
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

const taskRows = { deleteTask, getTask, insertTask, listTasks, setTaskStatus, toTask, updateTask };

export default taskRows;
