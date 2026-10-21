import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type extensionsTypes from "./extensions/index.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type sessionTelemetryTypes from "./observability/session-telemetry.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import type sdkTypes from "./sdk.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace agentSessionServicesTypes {
  interface AgentSessionRuntimeDiagnostic {
    type: "info" | "warning" | "error";
    message: string;
  }

  interface CreateAgentSessionServicesOptions {
    cwd: string;
    agentDir?: string | undefined;
    settingsManager?: settingsManagerTypes.SettingsManager | undefined;
    modelRuntime?: modelRuntimeTypes.ModelRuntime | undefined;
    modelRuntimeSignal?: AbortSignal | undefined;
    extensionFlagValues?: Map<string, boolean | string> | undefined;
    resourceLoaderOptions?: Omit<
      resourceLoaderTypes.DefaultResourceLoaderOptions,
      "cwd" | "agentDir" | "settingsManager"
    >;
    resourceLoaderReloadOptions?: resourceLoaderTypes.ResourceLoaderReloadOptions | undefined;
  }

  interface CreateAgentSessionFromServicesOptions {
    services: AgentSessionServices;
    sessionManager: sessionManagerTypes.SessionManager;
    sessionStartEvent?: extensionsTypes.SessionStartEvent | undefined;
    model?: aiTypes.Model<any> | undefined;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    scopedModels?:
      | Array<{ model: aiTypes.Model<any>; thinkingLevel?: agentTypes.ThinkingLevel | undefined }>
      | undefined;
    tools?: string[] | undefined;
    excludeTools?: sdkTypes.CreateAgentSessionOptions["excludeTools"] | undefined;
    noTools?: sdkTypes.CreateAgentSessionOptions["noTools"] | undefined;
    customTools?: extensionsTypes.ToolDefinition[] | undefined;
    telemetry?: sessionTelemetryTypes.SessionTelemetryOptions | undefined;
  }

  interface AgentSessionServices {
    cwd: string;
    agentDir: string;
    modelRuntime: modelRuntimeTypes.ModelRuntime;
    settingsManager: settingsManagerTypes.SettingsManager;
    resourceLoader: resourceLoaderTypes.ResourceLoader;
    diagnostics: AgentSessionRuntimeDiagnostic[];
  }
}

export type { agentSessionServicesTypes as default };
