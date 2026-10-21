import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionTypes from "./agent-session.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type sessionTelemetryTypes from "./observability/session-telemetry.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace sdkOptionsTypes {
  interface CreateAgentSessionOptions {
    cwd?: string;
    agentDir?: string;

    modelRuntime?: modelRuntimeTypes.ModelRuntime;

    model?: compatTypes.Model<any> | undefined;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    scopedModels?:
      | Array<{
          model: compatTypes.Model<any>;
          thinkingLevel?: agentTypes.ThinkingLevel | undefined;
        }>
      | undefined;

    noTools?: "all" | "builtin" | undefined;
    tools?: string[] | undefined;
    excludeTools?: string[] | undefined;
    customTools?: extensionsTypes.ToolDefinition[] | undefined;

    resourceLoader?: resourceLoaderTypes.ResourceLoader;

    sessionManager?: sessionManagerTypes.SessionManager;

    settingsManager?: settingsManagerTypes.SettingsManager;
    sessionStartEvent?: extensionsTypes.SessionStartEvent | undefined;
    isWorker?: boolean | undefined;
    telemetry?: sessionTelemetryTypes.SessionTelemetryOptions | undefined;
  }

  interface CreateAgentSessionResult {
    session: agentSessionTypes.AgentSession;
    extensionsResult: extensionsTypes.LoadExtensionsResult;
    modelFallbackMessage?: string | undefined;
  }
}

export type { sdkOptionsTypes as default };
