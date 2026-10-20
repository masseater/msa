import { Cause, Effect, Exit, Option } from "effect";
import type { JsonValue, SimpleHarnessResult } from "vitest-evals/harness";

import agentRun from "./agent-run.ts";
import agentSession from "./agent-session.ts";
import type runAgentTypes from "./run-agent.types.ts";
import runCleanup from "./run-cleanup.ts";
import runContext from "./run-context.ts";

const { throwIfAborted } = agentSession;
const { createRunContext } = runContext;
const { executeAgentRun } = agentRun;
const { cleanup, combineFailures, failRun } = runCleanup;

const runMsaCodingAgent = <TOutput extends JsonValue>(
  request: runAgentTypes.AgentRunRequest<TOutput>,
): Effect.Effect<SimpleHarnessResult<string | TOutput>> =>
  Effect.gen(function* () {
    const startedAt = performance.now();
    yield* throwIfAborted(request.signal);
    const { host, paths, state, extensionFactories } = yield* createRunContext(request.options);
    const exit = yield* Effect.exit(
      executeAgentRun({ context: { extensionFactories, host, paths }, request, state }),
    );
    const cleanupErrors = yield* cleanup({
      root: paths.root,
      setArtifact: request.setArtifact,
      state,
    });
    const failure = combineFailures({
      cleanupErrors,
      runError: Exit.isFailure(exit) ? Option.some(Cause.squash(exit.cause)) : Option.none(),
    });
    if (Option.isSome(failure)) {
      return yield* failRun({ failure: failure.value, input: request.input, startedAt, state });
    }
    if (state.result === undefined) {
      return yield* Effect.die(new Error("msa eval completed without a result."));
    }
    return { ...state.result, timings: { totalMs: performance.now() - startedAt } };
  });

const runAgent = {
  runMsaCodingAgent,
};

export default runAgent;
