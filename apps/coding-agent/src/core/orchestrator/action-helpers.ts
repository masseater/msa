import type { Runtime } from "./runtime.ts";
import { snapshots } from "./snapshot.ts";
import { store } from "./store.ts";
import type { Note, Task, TaskView } from "./types.ts";

function taskView(runtime: Runtime, id: string): TaskView {
  const found = snapshots
    .taskViews(runtime.database, runtime.options.project)
    .find((task) => task.id === id);
  if (found === undefined) throw new Error(`Unknown task: ${id}`);
  return found;
}

function runningThreadOf(runtime: Runtime, taskId: string) {
  for (const assignment of store.assignmentsOfTask(runtime.database, taskId)) {
    const thread = store.getThread(runtime.database, assignment.threadId);
    if (thread?.status === "running") return thread;
  }
  return undefined;
}

function appliesTo(note: Pick<Note, "round" | "taskIds">, task: Task): boolean {
  if (note.round !== null) return task.round === note.round;
  if (note.taskIds.length === 0) return true;
  return note.taskIds.includes(task.id);
}

export const actionHelpers = { appliesTo, runningThreadOf, taskView };
