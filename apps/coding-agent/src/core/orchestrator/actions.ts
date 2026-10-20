import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import idsModule from "./ids.ts";
import roundsModule from "./rounds.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import taskActionsModule from "./task-actions.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { orchestratorError } = errors;
const { requireStates } = text;
const { newId } = idsModule;
const { rounds } = roundsModule;
const { scheduling } = schedule;
const { actionHelpers } = actionHelpersModule;
const { taskActions } = taskActionsModule;

function resolveRound(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.CreateTaskInput,
): string {
  if (input.round !== undefined) return input.round;
  const dependencies = input.dependsOn ?? [];
  if (dependencies.length === 0) return "main";
  const dependencyRounds = new Set<string>();
  for (const id of dependencies) {
    const task = store.getTask(runtime.database, id);
    if (task === undefined) throw new Error(`Unknown task: ${id}`);
    dependencyRounds.add(task.round);
  }
  if (dependencyRounds.size !== 1) {
    throw new Error("Dependencies belong to different rounds; pass round explicitly.");
  }
  return [...dependencyRounds][0]!;
}

function createTask(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.CreateTaskInput,
): Effect.Effect<orchestratorTypesTypes.TaskView, errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const project = runtime.options.project;
    const states = requireStates(`Task ${input.title}`, input.currentState, input.goalState);
    if (input.model !== undefined) runtime.options.resolveModel(input.model);
    const round = resolveRound(runtime, input);
    const id = newId("t");
    const task: orchestratorTypesTypes.Task = {
      condition: input.condition ?? null,
      createdAt: now,
      currentState: states.currentState,
      cwd: input.cwd ?? runtime.options.cwd,
      goalState: states.goalState,
      id,
      kind: "work",
      model: input.model ?? null,
      project,
      round,
      status: "waiting",
      thinkingLevel: input.thinkingLevel ?? null,
      title: input.title,
      updatedAt: now,
    };
    yield* Effect.sync(() => {
      store.transaction(database, () => {
        store.insertRound(database, project, round, round, now);
        const review = rounds.ensureReview(runtime, round, now);
        store.insertTask(database, task);
        for (const dependency of input.dependsOn ?? []) {
          store.addDependency(database, project, id, dependency);
        }
        rounds.attachReview(runtime, review, id, now);
      });
    });
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, id);
  });
}

interface DependencyEdit {
  taskIds: readonly string[];
  add: readonly string[];
  remove: readonly string[];
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function taskOf(
  runtime: runtimeTypes.Runtime,
  id: string,
  label: string,
): orchestratorTypesTypes.Task {
  const task = store.getTask(runtime.database, id);
  if (task === undefined || task.project !== runtime.options.project) {
    throw new Error(`Unknown task in ${label}: ${id}`);
  }
  return task;
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
  if (unfinished.length > 0) {
    throw new Error(
      `${running.join(", ")} is running, so it can only gain a dependency that already finished. Stop it with stop_task to wait for ${unfinished.join(", ")}.`,
    );
  }
  return { add, remove, taskIds };
}

function setDepends(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.SetTaskDependsInput,
): Effect.Effect<orchestratorTypesTypes.TaskView[], errorsTypes.OrchestratorError> {
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

function setState(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.SetTaskStateInput,
): Effect.Effect<orchestratorTypesTypes.TaskView, errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    if (input.currentState === undefined && input.goalState === undefined) {
      throw new Error("Pass the current state, the goal state, or both");
    }
    const task = yield* Effect.sync(() => taskOf(runtime, input.taskId, "taskId"));
    if (task.kind === "review") {
      throw new Error(`${task.id} is a round review; its states come from the round`);
    }
    if (task.status === "running") {
      throw new Error(
        `${task.id} is running. Stop it with stop_task before rewriting its states, or send_message to steer it now.`,
      );
    }
    const states = requireStates(
      `Task ${task.id}`,
      input.currentState ?? task.currentState,
      input.goalState ?? task.goalState,
    );
    yield* Effect.sync(() => store.updateTask(runtime.database, task.id, states, now));
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, task.id);
  });
}

function setModel(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  model: string,
  thinkingLevel?: agentTypes.ThinkingLevel,
): Effect.Effect<orchestratorTypesTypes.TaskView, errorsTypes.OrchestratorError> {
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

const actions = {
  createTask,
  setDepends,
  setModel,
  setState,
  ...taskActions,
};

const actionsModule = {
  actions,
};

export default actionsModule;
