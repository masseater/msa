import { getCurrentSystemPrompt } from "@msa/ai/utils/transcript";
import { Effect } from "effect";
import type { HarnessContext, JsonValue } from "vitest-evals/harness";

import { assertOnlyInlineExtensions, openSession, prepareModel } from "./agent-session.ts";
import { runSteps } from "./agent-steps.ts";
import { collectDiagnostics } from "./diagnostics.ts";
import type { MsaCodingAgentInput } from "./harness-types.ts";
import type { AgentRunContext, Options, RunState } from "./run-types.ts";
import { enterToolSandbox } from "./sandbox.ts";
import { verifySystemPrompt } from "./system-prompt.ts";

export const executeAgentRun = <TOutput extends JsonValue>({
  state,
  request,
  context,
}: {
  state: RunState<TOutput>;
  request: {
    input: MsaCodingAgentInput;
    signal: AbortSignal | undefined;
    setArtifact: HarnessContext["setArtifact"];
    options: Options<TOutput>;
  };
  context: AgentRunContext;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { input, signal, setArtifact, options } = request;
    const { host, paths, extensionFactories } = context;
    const prepared = yield* prepareModel({ state, options, paths, host });
    const { session, sessionManager } = yield* openSession({
      state,
      options,
      paths,
      prepared,
      extensionFactories,
      signal,
    });
    setArtifact("runId", sessionManager.getSessionId());
    yield* assertOnlyInlineExtensions({ session, extensionFactories });
    yield* enterToolSandbox(paths.root, host.sandboxIdentity);
    const response = yield* runSteps({ session, input, signal });
    const systemPrompt = state.forcedSystemPrompt ?? getCurrentSystemPrompt(session.messages);
    const diagnostics = yield* collectDiagnostics({
      session,
      model: prepared.model,
      systemPrompt,
    });
    state.diagnostics = diagnostics;
    yield* Effect.sync(() => verifySystemPrompt(systemPrompt, options));
    const output =
      "output" in options
        ? yield* options.output({ response, session, systemPrompt, agentDir: paths.agentDir })
        : response;
    state.result = { output, ...diagnostics };
  });
