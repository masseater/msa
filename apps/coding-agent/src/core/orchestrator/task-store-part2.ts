import type { DatabaseSync } from "node:sqlite";

import type taskStoreInternalTypes from "./task-store-internal.types.ts";
import taskStorePart1 from "./task-store-part1.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const {
  addDependency,
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
  toTask,
  unfinishedDependencies,
  updateTask,
} = taskStorePart1;

function workTasksOfRound(
  database: DatabaseSync,
  project: string,
  round: string,
): orchestratorTypesTypes.Task[] {
  const rows = database
    .prepare(
      "SELECT * FROM tasks WHERE project = ? AND round = ? AND kind = 'work' ORDER BY created_at, id",
    )
    .all(project, round) as unknown as taskStoreInternalTypes.TaskRow[];
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

const taskStore = {
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

const taskStorePart2 = {
  taskStore,
};

export default taskStorePart2;
