import { Effect, Fiber } from "effect";

import { conditions } from "./condition.ts";
import { type OrchestratorError, orchestratorError } from "./errors.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { starting } from "./start.ts";
import { store } from "./store.ts";

function scheduleEffect(runtime: Runtime): Effect.Effect<string[], OrchestratorError> {
  return Effect.gen(function* () {
    if (runtime.replanning) return [];
    const database = runtime.database;
    const project = runtime.options.project;
    const running = store.runningThreads(database, project);
    let free = runtime.maxConcurrentThreads - running.length;
    const started: string[] = [];
    for (const task of store.readyTasks(database, project, "work")) {
      if (free <= 0) break;
      yield* starting.startTasks(runtime, task, "worker");
      started.push(task.id);
      free--;
    }
    for (const review of store.readyTasks(database, project, "review")) {
      if (free <= 0) break;
      yield* starting.startTasks(runtime, review, "reviewer");
      started.push(review.id);
      free--;
    }
    return started;
  });
}

function pollEffect(runtime: Runtime): Effect.Effect<void, OrchestratorError> {
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

function startPolling(runtime: Runtime, intervalMs: number): Fiber.Fiber<never, never> {
  return Effect.runFork(
    Effect.forever(
      Effect.sleep(intervalMs).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => runtime.exclusive(pollEffect(runtime)),
            catch: orchestratorError,
          }).pipe(Effect.ignore),
        ),
      ),
    ),
  );
}

export const scheduling = { scheduleEffect, startPolling };
