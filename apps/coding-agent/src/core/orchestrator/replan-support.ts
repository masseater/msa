import { type Deferred, Effect, Result } from "effect";

import { OrchestratorError, orchestratorError } from "./errors.ts";
import type { Runtime } from "./runtime.ts";
import { wrapping } from "./wrap-up.ts";

export interface StopOutcome {
  aborted: string | null;
  memos: Map<string, string>;
}

export function fail(message: string): OrchestratorError {
  return new OrchestratorError({ message });
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function exclusive<A>(
  runtime: Runtime,
  effect: Effect.Effect<A, OrchestratorError>,
): Effect.Effect<A, OrchestratorError> {
  return Effect.tryPromise({ catch: orchestratorError, try: () => runtime.exclusive(effect) });
}

export function release(runtime: Runtime): void {
  runtime.replanning = false;
  for (const threadId of [...runtime.wrapUps.keys()]) wrapping.cancel(runtime, threadId);
}

export function ensured<A>(
  runtime: Runtime,
  effect: Effect.Effect<A, OrchestratorError>,
): Effect.Effect<A, OrchestratorError> {
  return effect.pipe(
    Effect.ensuring(
      exclusive(
        runtime,
        Effect.sync(() => release(runtime)),
      ).pipe(Effect.ignore),
    ),
  );
}

export function stopThreads(
  runtime: Runtime,
  memos: ReadonlyMap<string, Deferred.Deferred<string, string>>,
): Effect.Effect<StopOutcome> {
  return Effect.gen(function* () {
    const stopped = new Map<string, string>();
    for (const [threadId, memo] of memos) {
      const result = yield* Effect.result(wrapping.awaitMemo(runtime, threadId, memo));
      if (Result.isFailure(result)) {
        return { aborted: `${threadId}: ${result.failure}`, memos: stopped };
      }
      stopped.set(threadId, result.success);
    }
    return { aborted: null, memos: stopped };
  });
}
