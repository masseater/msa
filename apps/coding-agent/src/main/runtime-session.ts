import type argsTypes from "../cli/args.types.ts";
import agentSessionServices from "../core/agent-session-services.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import awaitingModule from "../core/awaiting.ts";
import type typesSessionEventsTypes from "../core/extensions/types-session-events.ts";
import ModelRuntime from "../core/model-runtime.ts";
import type telemetryTypesNs from "../core/observability/telemetry.types.ts";
import type sdkTypes from "../core/sdk.types.ts";
import SessionManager from "../core/session-manager.ts";
import sessionOptionsModule from "./session-options.ts";

const { createAgentSessionFromServices } = agentSessionServices;
const { awaited } = awaitingModule;
const { buildSessionOptions } = sessionOptionsModule;

function* applyCliApiKey(
  parsed: argsTypes.Args,
  sessionOptions: sdkTypes.CreateAgentSessionOptions,
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
  modelRuntime: ModelRuntime,
) {
  if (parsed.apiKey !== undefined && parsed.apiKey !== "") {
    if (sessionOptions.model === undefined) {
      diagnostics.push({
        message:
          "--api-key requires a model to be specified via --model, --provider/--model, or --models",
        type: "error",
      });
    } else {
      yield* awaited(modelRuntime.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey));
    }
  }
}

function* createSessionFromServices(
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
  sessionOptionDiagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
  parsed: argsTypes.Args,
  sessionOptions: sdkTypes.CreateAgentSessionOptions,
  modelRuntime: ModelRuntime,
  services: agentSessionServicesTypes.AgentSessionServices,
  runtimeSessionManager: SessionManager,
  sessionStartEvent: typesSessionEventsTypes.SessionStartEvent | undefined,
  telemetry: telemetryTypesNs.TelemetryHandle | undefined,
  cliThinkingFromModel: boolean,
) {
  diagnostics.push(...sessionOptionDiagnostics);

  yield* applyCliApiKey(parsed, sessionOptions, diagnostics, modelRuntime);

  const created = yield* awaited(
    createAgentSessionFromServices({
      customTools: sessionOptions.customTools,
      excludeTools: sessionOptions.excludeTools,
      inspectOnly: parsed.help === true || parsed.listModels !== undefined,
      model: sessionOptions.model,
      noTools: sessionOptions.noTools,
      scopedModels: sessionOptions.scopedModels,
      services,
      sessionManager: runtimeSessionManager,
      sessionStartEvent,
      telemetry: telemetry === undefined ? undefined : { context: telemetry.context, role: "main" },
      thinkingLevel: sessionOptions.thinkingLevel,
      tools: sessionOptions.tools,
    }),
  );
  const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
  if (created.session.model !== undefined && cliThinkingOverride) {
    created.session.models.thinking.setThinkingLevel(created.session.thinkingLevel);
  }

  return {
    ...created,
    diagnostics,
    services,
  };
}

function* sessionFromServices(
  parsed: argsTypes.Args,
  services: agentSessionServicesTypes.AgentSessionServices,
  scopedModels: Parameters<typeof buildSessionOptions>[1],
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
  args: {
    sessionManager: SessionManager;
    sessionStartEvent: typesSessionEventsTypes.SessionStartEvent | undefined;
    telemetry: telemetryTypesNs.TelemetryHandle | undefined;
  },
) {
  const { modelRuntime, settingsManager } = services;
  const built = buildSessionOptions(
    parsed,
    scopedModels,
    args.sessionManager.buildSessionContext().messages.length > 0,
    modelRuntime,
    settingsManager,
  );
  return yield* createSessionFromServices(
    diagnostics,
    built.diagnostics,
    parsed,
    built.options,
    modelRuntime,
    services,
    args.sessionManager,
    args.sessionStartEvent,
    args.telemetry,
    built.cliThinkingFromModel,
  );
}

const runtimeSession = { sessionFromServices };

export default runtimeSession;
