import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";

const { awaited, awaiting } = awaitingModule;

function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Effect.Effect<T[]> {
  return awaiting(function* () {
    if (tasks.length === 0) {
      return [];
    }
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(limit, tasks.length));
    const worker = () =>
      Effect.runPromise(
        awaiting(function* () {
          while (true) {
            const index = nextIndex;
            nextIndex += 1;
            const task = tasks[index];
            if (task === undefined) {
              return;
            }
            results[index] = yield* awaited(task());
          }
        }),
      );
    yield* awaited(Promise.all(Array.from({ length: workerCount }, () => worker())));
    return results;
  });
}

const concurrency = { runWithConcurrency };

export default concurrency;
