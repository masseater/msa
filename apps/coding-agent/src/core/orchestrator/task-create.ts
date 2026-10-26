import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import idsModule from "./ids.ts";
import roundsModule from "./rounds.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import taskAdmission from "./task-admission.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { newId } = idsModule;
const { rounds } = roundsModule;
const { scheduling } = schedule;
const { actionHelpers } = actionHelpersModule;
const { admitTask } = taskAdmission;

function createTask(runtime: runtimeTypes.Runtime, input: orchestratorTypesTypes.CreateTaskInput) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const database = runtime.database;
    const project = runtime.options.project;
    const { checks, mergeInto, round, states } = yield* admitTask(runtime, input);
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
      mergeInto,
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
        if (mergeInto !== null) store.linkMergeSources(database, project, mergeInto);
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
