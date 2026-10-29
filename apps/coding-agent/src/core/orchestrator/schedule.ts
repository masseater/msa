import { Effect, Fiber } from "effect";

import conditionModule from "./condition.ts";
import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import providerResumeModule from "./provider-resume.ts";
import reviewHold from "./review-hold.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import start from "./start.ts";
import storeModule from "./store.ts";

const { nowMillis } = runtimeModule;
const { orchestratorError } = errors;
const { store } = storeModule;
const { starting } = start;
const { conditions } = conditionModule;
const { resumeDue } = providerResumeModule;

function scheduleEffect(
  runtime: runtimeTypes.Runtime,
): Effect.Effect<string[], errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    if (runtime.replanning) return [];
    const database = runtime.database;
    const project = runtime.options.project;
    const now = yield* nowMillis;
    yield* reviewHold.holdReviews(runtime, now);
    const running = store.runningThreads(database, project);
    let free = runtime.maxConcurrentThreads - running.length;
    const started = yield* resumeDue(runtime, free, now);
    free -= started.length;
    for (const task of store.readyTasks(database, project, "work")) {
      if (free <= 0) break;
      if ((yield* starting.startTasks(runtime, task, "worker")) === undefined) continue;
      started.push(task.id);
      free--;
    }
    for (const review of store.readyTasks(database, project, "review")) {
      if (free <= 0) break;
      if ((yield* starting.startTasks(runtime, review, "reviewer")) === undefined) continue;
      started.push(review.id);
      free--;
    }
    return started;
  });
}

function pollEffect(
  runtime: runtimeTypes.Runtime,
): Effect.Effect<void, errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    for (const task of store.tasksWithCondition(runtime.database, runtime.options.project)) {
      if (task.condition === null) continue;
      const met = yield* conditions.runCondition(runtime, task.condition, task.cwd);
      if (met) {
        yield* Effect.sync(() =>
          store.updateTask(runtime.database, task.id, { condition: null }, now),
        );
      }
    }
    const started = yield* scheduleEffect(runtime);
    if (started.length > 0) yield* Effect.sync(() => runtime.publish());
  });
}

function startPolling(
  runtime: runtimeTypes.Runtime,
  intervalMs: number,
): Fiber.Fiber<never, never> {
  return Effect.runFork(
    Effect.forever(
      Effect.sleep(intervalMs).pipe(
        Effect.andThen(
          Effect.tryPromise({
            catch: orchestratorError,
            try: () => runtime.exclusive(pollEffect(runtime)),
          }).pipe(Effect.ignore),
        ),
      ),
    ),
  );
}

const scheduling = { holdReviews: reviewHold.holdReviews, scheduleEffect, startPolling };

const schedule = {
  scheduling,
};

export default schedule;
