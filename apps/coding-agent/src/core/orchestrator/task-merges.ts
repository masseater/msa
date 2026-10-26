import type DatabaseSync from "../platform/node/sqlite.ts";
import taskDependencies from "./task-dependencies.ts";
import taskRows from "./task-rows.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { addDependency, removeDependency } = taskDependencies;
const { getTask, listTasks, updateTask } = taskRows;

const ENDED: ReadonlySet<orchestratorTypesTypes.TaskStatus> = new Set([
  "failed",
  "stopped",
  "closed",
]);

function mergeSourcesOf(
  database: DatabaseSync,
  project: string,
  targetId: string,
): orchestratorTypesTypes.Task[] {
  return listTasks(database, project).filter(
    (task) => task.mergeInto === targetId && !ENDED.has(task.status),
  );
}

function linkMergeSources(database: DatabaseSync, project: string, targetId: string): void {
  if (getTask(database, targetId)?.status !== "waiting") return;
  for (const source of mergeSourcesOf(database, project, targetId)) {
    addDependency(database, project, targetId, source.id);
  }
}

function linkAllMergeSources(database: DatabaseSync, project: string): void {
  const targets = new Set(
    listTasks(database, project).flatMap((task) =>
      task.mergeInto === null || ENDED.has(task.status) ? [] : [task.mergeInto],
    ),
  );
  for (const target of targets) linkMergeSources(database, project, target);
}

function retargetMerges(
  database: DatabaseSync,
  project: string,
  replaced: ReadonlyMap<string, string>,
  now: number,
): void {
  for (const task of listTasks(database, project)) {
    if (task.mergeInto === null || ENDED.has(task.status)) continue;
    const next = replaced.get(task.mergeInto);
    if (next !== undefined) updateTask(database, task.id, { mergeInto: next }, now);
  }
}

function unlinkMergeSources(database: DatabaseSync, taskIds: readonly string[]): void {
  for (const id of taskIds) {
    const task = getTask(database, id);
    if (task !== undefined && task.mergeInto !== null) {
      removeDependency(database, task.mergeInto, id);
    }
  }
}

function guardMergeDependency(
  database: DatabaseSync,
  project: string,
  taskId: string,
  dependsOn: string,
): void {
  if (mergeSourcesOf(database, project, taskId).some((source) => source.id === dependsOn)) {
    throw new Error(
      `${dependsOn} merges into ${taskId}, so ${taskId} waits for it. Drop or replace ${dependsOn} with replan instead.`,
    );
  }
}

const taskMerges = {
  guardMergeDependency,
  linkAllMergeSources,
  linkMergeSources,
  mergeSourcesOf,
  retargetMerges,
  unlinkMergeSources,
};

export default taskMerges;
