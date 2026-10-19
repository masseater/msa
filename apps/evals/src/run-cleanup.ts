import { Cause, Effect, Exit, Option } from "effect";
import {
  attachHarnessRunToError,
  type HarnessContext,
  type JsonValue,
  normalizeHarnessRun,
} from "vitest-evals/harness";

import type { MsaCodingAgentInput } from "./harness-types.ts";
import { files, setEnv } from "./platform.ts";
import { MSA_SESSION_SNAPSHOT_ARTIFACT } from "./report-types.ts";
import type { RunState } from "./run-types.ts";

const collectingErrors =
  (errors: unknown[]) =>
  <A>(effect: Effect.Effect<A>): Effect.Effect<void> =>
    Effect.flatMap(Effect.exit(effect), (exit) =>
      Exit.isFailure(exit)
        ? Effect.sync(() => {
            errors.push(Cause.squash(exit.cause));
          })
        : Effect.void,
    );

export const cleanup = <TOutput extends JsonValue>({
  state,
  root,
  restoreEnvironment,
  setArtifact,
}: {
  state: RunState<TOutput>;
  root: string;
  restoreEnvironment: () => void;
  setArtifact: HarnessContext["setArtifact"];
}): Effect.Effect<unknown[]> =>
  Effect.gen(function* () {
    const errors: unknown[] = [];
    const collect = collectingErrors(errors);
    const sessionPath = state.sessionManager?.getSessionFile();
    if (state.sessionManager !== undefined) {
      const snapshot = Effect.gen(function* () {
        if (sessionPath === undefined || !(yield* files.exists(sessionPath))) {
          return yield* Effect.die(new Error("msa eval produced no session file."));
        }
        setArtifact(MSA_SESSION_SNAPSHOT_ARTIFACT, yield* files.readFileString(sessionPath));
      });
      yield* collect(snapshot);
    }
    yield* collect(Effect.sync(() => state.session?.dispose()));
    yield* collect(files.remove(root));
    restoreEnvironment();
    const hidden = state.hiddenCredential;
    if (hidden !== undefined) setEnv(hidden.name, hidden.value);
    return errors;
  });

export const combineFailures = ({
  runError,
  cleanupErrors,
}: {
  runError: Option.Option<unknown>;
  cleanupErrors: readonly unknown[];
}): Option.Option<unknown> => {
  if (Option.isSome(runError) && cleanupErrors.length > 0) {
    return Option.some(
      new AggregateError(
        [runError.value, ...cleanupErrors],
        "Agent run failed and cleanup also failed.",
      ),
    );
  }
  if (cleanupErrors.length === 1) return Option.some(cleanupErrors[0]);
  if (cleanupErrors.length > 1) {
    return Option.some(new AggregateError(cleanupErrors, "Agent cleanup failed."));
  }
  return runError;
};

export const failRun = <TOutput extends JsonValue>({
  state,
  input,
  failure,
  startedAt,
}: {
  state: RunState<TOutput>;
  input: MsaCodingAgentInput;
  failure: unknown;
  startedAt: number;
}): Effect.Effect<never> => {
  const diagnostics = state.diagnostics;
  if (diagnostics === undefined) return Effect.die(failure);
  const partialRun = normalizeHarnessRun(input, {
    ...diagnostics,
    errors: [failure],
    timings: { totalMs: performance.now() - startedAt },
  });
  return Effect.die(attachHarnessRunToError(failure, partialRun));
};
