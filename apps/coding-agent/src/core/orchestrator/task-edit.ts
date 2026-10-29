import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import errors from "./errors.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { orchestratorError } = errors;
const { scheduling } = schedule;
const { actionHelpers } = actionHelpersModule;
const { taskOf } = actionHelpers;

interface DependencyEdit {
  taskIds: readonly string[];
  add: readonly string[];
  remove: readonly string[];
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function reviewing(runtime: runtimeTypes.Runtime, taskId: string): boolean {
  const thread = actionHelpers.runningThreadOf(runtime, taskId);
  if (thread === undefined) return false;
  return store
    .assignmentsOfThread(runtime.database, thread.id)
    .some((assignment) => assignment.taskId === taskId && assignment.role === "reviewer");
}

function dependencyEdit(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.SetTaskDependsInput,
): DependencyEdit {
  const taskIds = uniqueIds(input.taskIds);
  const add = uniqueIds(input.add ?? []);
  const remove = uniqueIds(input.remove ?? []);
  if (taskIds.length === 0) throw new Error("Pass the tasks to change in taskIds");
  if (add.length === 0 && remove.length === 0) {
    throw new Error("Pass the dependencies to add or remove");
  }
  const tasks = taskIds.map((id) => taskOf(runtime, id, "taskIds"));
  for (const task of tasks) {
    for (const id of remove) {
      store.guardMergeDependency(runtime.database, runtime.options.project, task.id, id);
    }
  }
  const dependencies = add.map((id) => taskOf(runtime, id, "add"));
  for (const task of tasks) {
    for (const dependency of dependencies) {
      if (task.id === dependency.id) throw new Error(`${task.id} cannot depend on itself`);
    }
  }
  const running = tasks.filter((task) => task.status === "running").map((task) => task.id);
  if (running.length === 0) return { add, remove, taskIds };
  if (remove.length > 0) {
    throw new Error(
      `${running.join(", ")} is running. Stop it with stop_task before dropping dependencies; send_message steers it while it runs.`,
    );
  }
  const unfinished = dependencies
    .filter((dependency) => dependency.status !== "completed")
    .map((dependency) => dependency.id);
  const working = running.filter((id) => !reviewing(runtime, id));
  if (unfinished.length > 0 && working.length > 0) {
    throw new Error(
      `${working.join(", ")} is running, so it can only gain a dependency that already finished. Stop it with stop_task to wait for ${unfinished.join(", ")}.`,
    );
  }
  return { add, remove, taskIds };
}

function setDepends(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.SetTaskDependsInput,
) {
  return Effect.gen(function* () {
    const edit = yield* Effect.sync(() => dependencyEdit(runtime, input));
    yield* Effect.sync(() =>
      store.transaction(runtime.database, () => {
        for (const taskId of edit.taskIds) {
          for (const dependsOn of edit.remove) {
            store.removeDependency(runtime.database, taskId, dependsOn);
          }
        }
        for (const taskId of edit.taskIds) {
          for (const dependsOn of edit.add) {
            store.addDependency(runtime.database, runtime.options.project, taskId, dependsOn);
          }
        }
      }),
    );
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return edit.taskIds.map((taskId) => actionHelpers.taskView(runtime, taskId));
  });
}

function setModel(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  model: string,
  thinkingLevel?: agentTypes.ThinkingLevel,
) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const resolved = runtime.options.resolveModel(model);
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    const patch = { model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) };
    yield* Effect.sync(() => store.updateTask(runtime.database, taskId, patch, now));
    const thread = actionHelpers.runningThreadOf(runtime, taskId);
    if (thread !== undefined) {
      const worker = runtime.workers.get(thread.id);
      if (worker !== undefined) {
        yield* Effect.tryPromise({
          catch: orchestratorError,
          try: () => worker.models.selection.setModel(resolved),
        });
        if (thinkingLevel !== undefined) worker.models.thinking.setThinkingLevel(thinkingLevel);
      }
      yield* Effect.sync(() => store.updateThread(runtime.database, thread.id, patch, now));
    }
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

const taskEdit = { setDepends, setModel };

export default taskEdit;
