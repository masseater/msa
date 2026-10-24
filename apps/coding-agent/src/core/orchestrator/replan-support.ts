import { type Deferred, Effect, Result } from "effect";

import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import OrchestratorError from "./orchestrator-error.ts";
import type replanSupportTypes from "./replan-support.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import wrapUp from "./wrap-up.ts";

const { orchestratorError } = errors;
const { wrapping } = wrapUp;

function fail(message: string): errorsTypes.OrchestratorError {
  return OrchestratorError.make({ message });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function exclusive<A>(
  runtime: runtimeTypes.Runtime,
  effect: Effect.Effect<A, errorsTypes.OrchestratorError>,
): Effect.Effect<A, errorsTypes.OrchestratorError> {
  return Effect.tryPromise({ catch: orchestratorError, try: () => runtime.exclusive(effect) });
}

function release(runtime: runtimeTypes.Runtime): void {
  runtime.replanning = false;
  for (const threadId of [...runtime.wrapUps.keys()]) wrapping.cancel(runtime, threadId);
}

function ensured<A>(
  runtime: runtimeTypes.Runtime,
  effect: Effect.Effect<A, errorsTypes.OrchestratorError>,
): Effect.Effect<A, errorsTypes.OrchestratorError> {
  return effect.pipe(
    Effect.ensuring(
      exclusive(
        runtime,
        Effect.sync(() => release(runtime)),
      ).pipe(Effect.ignore),
    ),
  );
}

function stopThreads(
  runtime: runtimeTypes.Runtime,
  memos: ReadonlyMap<string, Deferred.Deferred<string, string>>,
): Effect.Effect<replanSupportTypes.StopOutcome> {
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

const replanSupport = {
  ensured,
  exclusive,
  fail,
  release,
  stopThreads,
  unique,
};

export default replanSupport;
