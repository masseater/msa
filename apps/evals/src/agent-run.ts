import transcript from "@msa/ai/utils/transcript";
import { Effect } from "effect";
import type { HarnessContext, JsonValue } from "vitest-evals/harness";

import agentSession from "./agent-session.ts";
import agentSteps from "./agent-steps.ts";
import diagnosticsModule from "./diagnostics.ts";
import type harnessTypesTypes from "./harness-types.ts";
import type runTypesTypes from "./run-types.ts";
import sandbox from "./sandbox.ts";
import systemPromptModule from "./system-prompt.ts";

const { assertOnlyInlineExtensions, openSession, prepareModel } = agentSession;
const { enterToolSandbox } = sandbox;
const { runSteps } = agentSteps;
const { collectDiagnostics } = diagnosticsModule;
const { verifySystemPrompt } = systemPromptModule;

const { getCurrentSystemPrompt } = transcript;

const executeAgentRun = <TOutput extends JsonValue>({
  state,
  request,
  context,
}: {
  state: runTypesTypes.RunState<TOutput>;
  request: {
    input: harnessTypesTypes.MsaCodingAgentInput;
    signal: AbortSignal | undefined;
    setArtifact: HarnessContext["setArtifact"];
    options: runTypesTypes.Options<TOutput>;
  };
  context: runTypesTypes.AgentRunContext;
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

const agentRun = {
  executeAgentRun,
};

export default agentRun;
