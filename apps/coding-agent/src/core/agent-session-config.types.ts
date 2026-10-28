import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionIntegrationConfigTypes from "./agent-session-integration-config.types.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace agentSessionConfigTypes {
  interface AgentSessionConfig
    extends agentSessionIntegrationConfigTypes.AgentSessionIntegrationConfig {
    agent: agentTypes.Agent;
    sessionManager: sessionManagerTypes.SessionManager;
    settingsManager: settingsManagerTypes.SettingsManager;
    cwd: string;
    agentDir: string;
    scopedModels?:
      | Array<{
          model: compatTypes.Model<any>;
          thinkingLevel?: agentTypes.ThinkingLevel | undefined;
        }>
      | undefined;
    resourceLoader: resourceLoaderTypes.ResourceLoader;
    customTools?: extensionsTypes.ToolDefinition[] | undefined;
    modelRuntime: modelRuntimeTypes.ModelRuntime;
    cacheWarmer?: Pick<
      cacheWarmerTypes.CacheWarmer,
      "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed"
    >;
    initialActiveToolNames?: string[] | undefined;
    usesDefaultTools?: boolean | undefined;
    defaultToolModifiers?: string[] | undefined;
    allowedToolNames?: string[] | undefined;
    excludedToolNames?: string[] | undefined;
    baseToolsOverride?: Record<string, agentTypes.AgentTool> | undefined;
    extensionRunnerRef?: { current?: extensionsTypes.ExtensionRunner } | undefined;
    sessionStartEvent?: extensionsTypes.SessionStartEvent | undefined;
    isWorker?: boolean | undefined;
  }

  interface ExtensionBindings {
    uiContext?: extensionsTypes.ExtensionUIContext;
    mode?: extensionsTypes.ExtensionMode;
    commandContextActions?: extensionsTypes.ExtensionCommandContextActions;
    abortHandler?: () => void;
    shutdownHandler?: extensionsTypes.ShutdownHandler;
    onError?: extensionsTypes.ExtensionErrorListener;
  }
}

export type { agentSessionConfigTypes as default };
