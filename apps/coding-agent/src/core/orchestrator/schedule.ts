import { Effect, Fiber } from "effect";

import { conditions } from "./condition.ts";
import { type OrchestratorError, orchestratorError } from "./errors.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduler } from "./scheduler.ts";
import { starting } from "./start.ts";
import { store } from "./store.ts";

function scheduleEffect(runtime: Runtime): Effect.Effect<string[], OrchestratorError> {
  return Effect.gen(function* () {
    const database = runtime.database;
    const project = runtime.options.project;
    const running = store.runningSessions(database, project);
    let free = runtime.maxConcurrentSessions - running.length;
    const runningKeys = scheduler.occupiedKeys(
      store.listTasks(database, project).filter((task) => task.status === "running"),
    );
    const started: string[] = [];
    for (const cluster of scheduler.clusterByPaths(store.readyTasks(database, project, "work"))) {
      if (free <= 0) break;
      const keys = cluster.flatMap(scheduler.pathKeys);
      if (keys.length > 0 && scheduler.conflicts(keys, runningKeys)) continue;
      yield* starting.startTasks(runtime, cluster, "worker");
      started.push(...cluster.map((task) => task.id));
      runningKeys.push(...keys);
      free--;
    }
    for (const review of store.readyTasks(database, project, "review")) {
      if (free <= 0) break;
      yield* starting.startTasks(runtime, [review], "reviewer");
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
      const met = yield* conditions.runCondition(task.condition, task.cwd);
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
