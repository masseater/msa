import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import pullRequestNotice from "./pull-request-notice.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";

const { abortThread, nowMillis } = runtimeModule;
const { store } = storeModule;
const { scheduling } = schedule;
const { starting } = startModule;
const { actionHelpers } = actionHelpersModule;

function stop(runtime: runtimeTypes.Runtime, taskId: string) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const task = store.getTask(database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    const thread = actionHelpers.runningThreadOf(runtime, taskId);
    if (thread !== undefined) {
      abortThread(runtime, thread.id);
      yield* Effect.sync(() => store.updateThread(database, thread.id, { status: "stopped" }, now));
    }
    yield* Effect.sync(() => store.setTaskStatus(database, taskId, "stopped", now));
    yield* scheduling.scheduleEffect(runtime);
    const notice = yield* pullRequestNotice.openPullRequests(runtime, [taskId]);
    yield* Effect.sync(() => {
      runtime.publish();
      if (notice === undefined) return;
      runtime.options.report(`${task.title} (${taskId}) stopped.\n\n${notice}`, {
        role: "worker",
        started: [],
        status: "stopped",
        taskId,
      });
    });
    return actionHelpers.taskView(runtime, taskId);
  });
}

function rerun(runtime: runtimeTypes.Runtime, taskId: string, extra = "") {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    if (task.status === "running") throw new Error(`${taskId} is already running`);
    yield* starting.startTasks(runtime, task, "worker", "", extra);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

function setMaxConcurrent(runtime: runtimeTypes.Runtime, value: number) {
  return Effect.gen(function* () {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("max concurrent threads must be an integer of at least 1");
    }
    yield* Effect.sync(() =>
      store.storeMaxConcurrent(runtime.database, runtime.options.project, value),
    );
    runtime.maxConcurrentThreads = value;
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return value;
  });
}

const taskRunControl = { rerun, setMaxConcurrent, stop };

export default taskRunControl;
