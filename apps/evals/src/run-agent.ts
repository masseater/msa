import { Cause, Effect, Exit, Option } from "effect";
import type { HarnessContext, JsonValue, SimpleHarnessResult } from "vitest-evals/harness";

import { executeAgentRun } from "./agent-run.ts";
import { throwIfAborted } from "./agent-session.ts";
import type { MsaCodingAgentInput } from "./harness-types.ts";
import { cleanup, combineFailures, failRun } from "./run-cleanup.ts";
import { createRunContext } from "./run-context.ts";
import type { Options } from "./run-types.ts";

export type AgentRunRequest<TOutput extends JsonValue> = {
  input: MsaCodingAgentInput;
  signal: AbortSignal | undefined;
  setArtifact: HarnessContext["setArtifact"];
  options: Options<TOutput>;
};

export const runMsaCodingAgent = <TOutput extends JsonValue>(
  request: AgentRunRequest<TOutput>,
): Effect.Effect<SimpleHarnessResult<string | TOutput>> =>
  Effect.gen(function* () {
    const startedAt = performance.now();
    yield* throwIfAborted(request.signal);
    const { host, paths, state, extensionFactories } = yield* createRunContext(request.options);
    const exit = yield* Effect.exit(
      executeAgentRun({ state, request, context: { host, paths, extensionFactories } }),
    );
    const cleanupErrors = yield* cleanup({
      state,
      root: paths.root,
      setArtifact: request.setArtifact,
    });
    const failure = combineFailures({
      runError: Exit.isFailure(exit) ? Option.some(Cause.squash(exit.cause)) : Option.none(),
      cleanupErrors,
    });
    if (Option.isSome(failure)) {
      return yield* failRun({ state, input: request.input, failure: failure.value, startedAt });
    }
    if (state.result === undefined) {
      return yield* Effect.die(new Error("msa eval completed without a result."));
    }
    return { ...state.result, timings: { totalMs: performance.now() - startedAt } };
  });
