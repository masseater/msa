import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import errors from "./errors.ts";
import resumeModule from "./resume.ts";
import type runtimeTypes from "./runtime.types.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";
import taskNotes from "./task-notes.ts";

const { store } = storeModule;
const { starting } = startModule;
const { resuming } = resumeModule;
const { actionHelpers } = actionHelpersModule;
const { sendNote } = taskNotes;

function sendMessage(runtime: runtimeTypes.Runtime, taskId: string, message: string) {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    if (task.status === "closed") {
      throw new Error(errors.closedTaskMessage(taskId));
    }
    if (task.status === "needs-decision") {
      yield* resuming.resume(runtime, task, message);
      yield* Effect.sync(() => runtime.publish());
      return actionHelpers.taskView(runtime, taskId);
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
      yield* starting.startOrRefuse(runtime, task, "worker", "", message);
      yield* Effect.sync(() => runtime.publish());
      return actionHelpers.taskView(runtime, taskId);
    }
    yield* sendNote(runtime, { audience: "tasks", content: message, taskIds: [taskId] });
    return actionHelpers.taskView(runtime, taskId);
  });
}

function advise(runtime: runtimeTypes.Runtime, taskId: string, question: string) {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    if (task.status !== "needs-decision") {
      throw new Error(
        `${taskId} is ${task.status}; an advisor weighs the options of a task that waits for a decision`,
      );
    }
    yield* starting.startOrRefuse(runtime, task, "advisor", "", question);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

const taskMessages = { advise, sendMessage };

export default taskMessages;
