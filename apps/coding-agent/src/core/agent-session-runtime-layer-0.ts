import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import type telemetryTypesNs from "./observability/telemetry.types.ts";

export default abstract class AgentSessionRuntimeLayer0 {
  constructor(
    _session: agentSessionTypes.AgentSession,
    _services: agentSessionServicesTypes.AgentSessionServices,
    createRuntime: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory,
    _diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [],
    _modelFallbackMessage?: string,
    telemetry?: telemetryTypesNs.TelemetryHandle,
  ) {
    this.telemetry = telemetry;
    this.sessionInternal = _session;
    this.servicesInternal = _services;
    this.createRuntime = createRuntime;
    this.diagnosticsInternal = _diagnostics;
    this.modelFallbackMessageInternal = _modelFallbackMessage;
  }

  protected rebindSession?:
    | ((session: agentSessionTypes.AgentSession) => Promise<void>)
    | undefined;
  protected beforeSessionInvalidate?: (() => void) | undefined;
  protected sessionInternal!: agentSessionTypes.AgentSession;
  protected servicesInternal!: agentSessionServicesTypes.AgentSessionServices;
  protected createRuntime!: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory;
  protected diagnosticsInternal!: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];
  protected modelFallbackMessageInternal?: string | undefined;
  telemetry!: telemetryTypesNs.TelemetryHandle | undefined;
}
