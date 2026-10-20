import { Cause, Effect, Exit, Option } from "effect";
import {
  type HarnessContext,
  type JsonValue,
  attachHarnessRunToError,
  normalizeHarnessRun,
} from "vitest-evals/harness";

import type harnessTypesTypes from "./harness-types.ts";
import platform from "./platform.ts";
import reportTypes from "./report-types.ts";
import type runTypesTypes from "./run-types.ts";

const { files } = platform;
const { MSA_SESSION_SNAPSHOT_ARTIFACT } = reportTypes;

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

const cleanup = <TOutput extends JsonValue>({
  state,
  root,
  setArtifact,
}: {
  state: runTypesTypes.RunState<TOutput>;
  root: string;
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
    return errors;
  });

const combineFailures = ({
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

const failRun = <TOutput extends JsonValue>({
  state,
  input,
  failure,
  startedAt,
}: {
  state: runTypesTypes.RunState<TOutput>;
  input: harnessTypesTypes.MsaCodingAgentInput;
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

const runCleanup = {
  cleanup,
  combineFailures,
  failRun,
};

export default runCleanup;
