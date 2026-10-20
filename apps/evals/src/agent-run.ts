import transcript from "@msa/ai/utils/transcript";
import { Effect } from "effect";
import type { HarnessContext, JsonValue } from "vitest-evals/harness";

import { assertOnlyInlineExtensions, openSession, prepareModel } from "./agent-session.ts";
import { runSteps } from "./agent-steps.ts";
import { collectDiagnostics } from "./diagnostics.ts";
import type { MsaCodingAgentInput } from "./harness-types.ts";
import type { AgentRunContext, Options, RunState } from "./run-types.ts";
import { enterToolSandbox } from "./sandbox.ts";
import { verifySystemPrompt } from "./system-prompt.ts";

const { getCurrentSystemPrompt } = transcript;

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
    const prepared = yield* prepareModel({ host, options, paths });
    const { session, sessionManager } = yield* openSession({
      extensionFactories,
      options,
      paths,
      prepared,
      signal,
      state,
    });
    setArtifact("runId", sessionManager.getSessionId());
    yield* assertOnlyInlineExtensions({ extensionFactories, session });
    yield* enterToolSandbox(paths.root, host.sandboxIdentity);
    const response = yield* runSteps({ input, session, signal });
    const systemPrompt = state.forcedSystemPrompt ?? getCurrentSystemPrompt(session.messages);
    const diagnostics = yield* collectDiagnostics({
      model: prepared.model,
      session,
      systemPrompt,
    });
    state.diagnostics = diagnostics;
    yield* Effect.sync(() => verifySystemPrompt(systemPrompt, options));
    const output =
      "output" in options
        ? yield* options.output({ agentDir: paths.agentDir, response, session, systemPrompt })
        : response;
    state.result = { output, ...diagnostics };
  });
