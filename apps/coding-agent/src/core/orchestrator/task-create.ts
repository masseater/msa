import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import idsModule from "./ids.ts";
import roundsModule from "./rounds.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { requireChecks, requireStates } = text;
const { newId } = idsModule;
const { rounds } = roundsModule;
const { scheduling } = schedule;
const { actionHelpers } = actionHelpersModule;

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

function createTask(runtime: runtimeTypes.Runtime, input: orchestratorTypesTypes.CreateTaskInput) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const project = runtime.options.project;
    const states = requireStates(`Task ${input.title}`, input.currentState, input.goalState);
    const checks = requireChecks(`Task ${input.title}`, input.checks);
    if (input.model !== undefined) runtime.options.resolveModel(input.model);
    const round = resolveRound(runtime, input);
    const id = newId("t");
    const task: orchestratorTypesTypes.Task = {
      checks,
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

const taskCreate = { createTask };

export default taskCreate;
