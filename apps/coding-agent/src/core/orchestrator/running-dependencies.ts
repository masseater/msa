import actionHelpersModule from "./action-helpers.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";

const { store } = storeModule;
const { actionHelpers } = actionHelpersModule;

interface DependencyChange {
  taskId: string;
  add: readonly string[];
  remove: readonly string[];
}

function reviewing(runtime: runtimeTypes.Runtime, taskId: string): boolean {
  const thread = actionHelpers.runningThreadOf(runtime, taskId);
  if (thread === undefined) return false;
  return store
    .assignmentsOfThread(runtime.database, thread.id)
    .some((assignment) => assignment.taskId === taskId && assignment.role === "reviewer");
}

function named(taskIds: readonly string[]): string {
  return `${taskIds.join(", ")} ${taskIds.length === 1 ? "is" : "are"} running`;
}

function finished(runtime: runtimeTypes.Runtime, id: string): boolean {
  return store.getTask(runtime.database, id)?.status === "completed";
}

function guard(runtime: runtimeTypes.Runtime, changes: readonly DependencyChange[]): void {
  const running = changes.filter(
    (change) => store.getTask(runtime.database, change.taskId)?.status === "running",
  );
  const dropping = running.filter((change) => change.remove.length > 0);
  if (dropping.length > 0) {
    throw new Error(
      `${named(dropping.map((change) => change.taskId))}. Stop it with stop_task, or replan with stop left true, before dropping dependencies; send_message steers it while it runs.`,
    );
  }
  const blocked = running
    .filter((change) => !reviewing(runtime, change.taskId))
    .map((change) => ({
      taskId: change.taskId,
      unfinished: change.add.filter((id) => !finished(runtime, id)),
    }))
    .filter((change) => change.unfinished.length > 0);
  if (blocked.length > 0) {
    const unfinished = [...new Set(blocked.flatMap((change) => change.unfinished))];
    throw new Error(
      `${named(blocked.map((change) => change.taskId))}, so it can only gain a dependency that already finished. Stop it with stop_task, or replan with stop left true, to wait for ${unfinished.join(", ")}.`,
    );
  }
}

const runningDependencies = { guard };

export default runningDependencies;
