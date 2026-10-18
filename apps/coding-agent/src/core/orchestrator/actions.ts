import type { ThinkingLevel } from "@msa/agent-core";
import { Effect } from "effect";

import { actionHelpers } from "./action-helpers.ts";
import { type OrchestratorError, orchestratorError } from "./errors.ts";
import { newId } from "./ids.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduling } from "./schedule.ts";
import { store } from "./store.ts";
import { taskActions } from "./task-actions.ts";
import type { CreateTaskInput, Task, TaskView } from "./types.ts";

function resolveRound(runtime: Runtime, input: CreateTaskInput): string {
  if (input.round !== undefined) return input.round;
  const dependencies = input.dependsOn ?? [];
  if (dependencies.length === 0) return "main";
  const rounds = new Set<string>();
  for (const id of dependencies) {
    const task = store.getTask(runtime.database, id);
    if (task === undefined) throw new Error(`Unknown task: ${id}`);
    rounds.add(task.round);
  }
  if (rounds.size !== 1) {
    throw new Error("Dependencies belong to different rounds; pass round explicitly.");
  }
  return [...rounds][0]!;
}

function ensureReview(runtime: Runtime, round: string, now: number): Task {
  const database = runtime.database;
  const project = runtime.options.project;
  const existing = store.reviewTaskOfRound(database, project, round);
  if (existing !== undefined) return existing;
  const review: Task = {
    id: newId("rev"),
    project,
    round,
    kind: "review",
    title: `Review of ${round}`,
    prompt: "",
    status: "waiting",
    priority: -1000,
    cwd: runtime.options.cwd,
    paths: [],
    repos: [],
    condition: null,
    model: null,
    thinkingLevel: null,
    createdAt: now,
    updatedAt: now,
  };
  store.insertTask(database, review);
  return review;
}

function createTask(
  runtime: Runtime,
  input: CreateTaskInput,
): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const project = runtime.options.project;
    if (input.model !== undefined) runtime.options.resolveModel(input.model);
    const round = resolveRound(runtime, input);
    const id = newId("t");
    const task: Task = {
      id,
      project,
      round,
      kind: "work",
      title: input.title,
      prompt: input.prompt,
      status: "waiting",
      priority: input.priority ?? 0,
      cwd: input.cwd ?? runtime.options.cwd,
      paths: input.paths ?? [],
      repos: input.repos ?? [],
      condition: input.condition ?? null,
      model: input.model ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      createdAt: now,
      updatedAt: now,
    };
    yield* Effect.sync(() => {
      store.transaction(database, () => {
        store.insertRound(database, project, round, round, now);
        const review = ensureReview(runtime, round, now);
        store.insertTask(database, task);
        for (const dependency of input.dependsOn ?? []) {
          store.addDependency(database, project, id, dependency);
        }
        store.addDependency(database, project, review.id, id);
        if (review.status !== "waiting" && review.status !== "running") {
          store.setTaskStatus(database, review.id, "waiting", now);
        }
      });
    });
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, id);
  });
}

function addDependency(
  runtime: Runtime,
  taskId: string,
  dependsOn: string,
): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    yield* Effect.sync(() =>
      store.addDependency(runtime.database, runtime.options.project, taskId, dependsOn),
    );
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

function removeDependency(
  runtime: Runtime,
  taskId: string,
  dependsOn: string,
): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => store.removeDependency(runtime.database, taskId, dependsOn));
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

function setPriority(
  runtime: Runtime,
  taskId: string,
  priority: number,
): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    yield* Effect.sync(() => store.updateTask(runtime.database, taskId, { priority }, now));
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

function setModel(
  runtime: Runtime,
  taskId: string,
  model: string,
  thinkingLevel?: ThinkingLevel,
): Effect.Effect<TaskView, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const resolved = runtime.options.resolveModel(model);
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) throw new Error(`Unknown task: ${taskId}`);
    const patch = { model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) };
    yield* Effect.sync(() => store.updateTask(runtime.database, taskId, patch, now));
    const session = actionHelpers.runningSessionOf(runtime, taskId);
    if (session !== undefined) {
      const worker = runtime.workers.get(session.id);
      if (worker !== undefined) {
        yield* Effect.tryPromise({
          try: () => worker.setModel(resolved),
          catch: orchestratorError,
        });
        if (thinkingLevel !== undefined) worker.setThinkingLevel(thinkingLevel);
      }
      yield* Effect.sync(() => store.updateSession(runtime.database, session.id, patch, now));
    }
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, taskId);
  });
}

export const actions = {
  createTask,
  addDependency,
  removeDependency,
  setPriority,
  setModel,
  ...taskActions,
};
