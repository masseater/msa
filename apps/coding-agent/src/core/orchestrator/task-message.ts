import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import providerResume from "./provider-resume.ts";
import type runtimeTypes from "./runtime.types.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";
import taskNotes from "./task-notes.ts";

const { store } = storeModule;
const { starting } = startModule;
const { actionHelpers } = actionHelpersModule;
const { sendNote } = taskNotes;

function sendMessage(runtime: runtimeTypes.Runtime, taskId: string, message: string) {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
      yield* starting.startTasks(runtime, task, "worker", "", message);
      yield* Effect.sync(() => runtime.publish());
      return actionHelpers.taskView(runtime, taskId);
    }
    yield* sendNote(runtime, { audience: "tasks", content: message, taskIds: [taskId] });
    const decided = providerResume.awaitingDecision(runtime, taskId);
    if (decided !== undefined && task.status === "waiting") {
      yield* providerResume.resumeTask(runtime, task, decided);
      yield* Effect.sync(() => runtime.publish());
    }
    return actionHelpers.taskView(runtime, taskId);
  });
}

const taskMessage = { sendMessage };

export default taskMessage;
