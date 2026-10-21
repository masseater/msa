import type runtimeTypes from "./runtime.types.ts";
import snapshot from "./snapshot.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { snapshots } = snapshot;
const { store } = storeModule;

function taskView(runtime: runtimeTypes.Runtime, id: string): orchestratorTypesTypes.TaskView {
  const found = snapshots
    .taskViews(runtime.database, runtime.options.project)
    .find((task) => task.id === id);
  if (found === undefined) throw new Error(`Unknown task: ${id}`);
  return found;
}

function runningThreadOf(runtime: runtimeTypes.Runtime, taskId: string) {
  for (const assignment of store.assignmentsOfTask(runtime.database, taskId)) {
    const thread = store.getThread(runtime.database, assignment.threadId);
    if (thread?.status === "running") return thread;
  }
  return undefined;
}

function appliesTo(
  note: Pick<orchestratorTypesTypes.Note, "round" | "taskIds">,
  task: orchestratorTypesTypes.Task,
): boolean {
  if (note.round !== null) return task.round === note.round;
  if (note.taskIds.length === 0) return true;
  return note.taskIds.includes(task.id);
}

const actionHelpers = { appliesTo, runningThreadOf, taskView };

const actionHelpersModule = {
  actionHelpers,
};

export default actionHelpersModule;
