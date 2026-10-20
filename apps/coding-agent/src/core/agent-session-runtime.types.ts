import type AgentSessionRuntimeClass from "./agent-session-runtime.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type sdkTypes from "./sdk.types.ts";
import type SessionImportFileNotFoundErrorClass from "./session-import-file-not-found-error.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

declare namespace agentSessionRuntimeTypes {
  interface CreateAgentSessionRuntimeResult extends sdkTypes.CreateAgentSessionResult {
    services: agentSessionServicesTypes.AgentSessionServices;
    diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];
  }

  type CreateAgentSessionRuntimeFactory = (options: {
    cwd: string;
    agentDir: string;
    sessionManager: sessionManagerTypes.SessionManager;
    sessionStartEvent?: extensionsTypes.SessionStartEvent | undefined;
    projectTrustContext?: extensionsTypes.ProjectTrustContext | undefined;
  }) => Promise<CreateAgentSessionRuntimeResult>;

  type SessionImportFileNotFoundError = (typeof SessionImportFileNotFoundErrorClass)["prototype"];

  type AgentSessionRuntime = (typeof AgentSessionRuntimeClass)["prototype"];

  type AgentSessionRuntimeDiagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;

  type AgentSessionServices = agentSessionServicesTypes.AgentSessionServices;

  type CreateAgentSessionFromServicesOptions =
    agentSessionServicesTypes.CreateAgentSessionFromServicesOptions;

  type CreateAgentSessionServicesOptions =
    agentSessionServicesTypes.CreateAgentSessionServicesOptions;
}

export type { agentSessionRuntimeTypes as default };
