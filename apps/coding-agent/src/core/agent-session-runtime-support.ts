import AgentSessionRuntime from "./agent-session-runtime.ts";
import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type telemetryTypesNs from "./observability/telemetry.types.ts";
import sessionCwd from "./session-cwd.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
const { awaited, promised } = awaitingModule;
const { assertSessionCwdExists } = sessionCwd;

function createAgentSessionRuntime(
  createRuntime: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory,
  options: {
    cwd: string;
    agentDir: string;
    sessionManager: sessionManagerTypes.SessionManager;
    sessionStartEvent?: extensionsTypes.SessionStartEvent;
    telemetry?: telemetryTypesNs.TelemetryHandle;
  },
): Promise<AgentSessionRuntime> {
  return promised(function* () {
    yield* awaited(assertSessionCwdExists(options.sessionManager, options.cwd));
    const result = yield* awaited(createRuntime(options));
    return new AgentSessionRuntime(
      result.session,
      result.services,
      createRuntime,
      result.diagnostics,
      result.modelFallbackMessage,
      options.telemetry,
    );
  });
}

const agentSessionRuntimeSupport = {
  createAgentSessionRuntime,
};

export default agentSessionRuntimeSupport;
