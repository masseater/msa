import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type { TSchema } from "typebox";

import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type sessionTelemetryTypes from "./observability/session-telemetry.types.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type skillsTypes from "./skills.types.ts";
import type toolsTypes from "./tools/index.types.ts";

declare namespace sdkTypes {
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

  type CreateAgentSessionRuntimeResult = agentSessionRuntimeTypes.CreateAgentSessionRuntimeResult;

  type CreateAgentSessionRuntimeFactory = agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory;

  type SessionImportFileNotFoundError = agentSessionRuntimeTypes.SessionImportFileNotFoundError;

  type AgentSessionRuntime = agentSessionRuntimeTypes.AgentSessionRuntime;

  type AgentSessionRuntimeDiagnostic = agentSessionRuntimeTypes.AgentSessionRuntimeDiagnostic;

  type AgentSessionServices = agentSessionRuntimeTypes.AgentSessionServices;

  type CreateAgentSessionFromServicesOptions =
    agentSessionRuntimeTypes.CreateAgentSessionFromServicesOptions;

  type CreateAgentSessionServicesOptions =
    agentSessionRuntimeTypes.CreateAgentSessionServicesOptions;

  type ExtensionAPI = extensionsTypes.ExtensionAPI;

  type ExtensionCommandContext = extensionsTypes.ExtensionCommandContext;

  type ExtensionContext = extensionsTypes.ExtensionContext;

  type ExtensionFactory = extensionsTypes.ExtensionFactory;

  type InlineExtension = extensionsTypes.InlineExtension;

  type SlashCommandInfo = extensionsTypes.SlashCommandInfo;

  type SlashCommandSource = extensionsTypes.SlashCommandSource;

  type ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
    TState = any,
  > = extensionsTypes.ToolDefinition<TParams, TDetails, TState>;

  type PromptTemplate = promptTemplatesTypes.PromptTemplate;

  type Skill = skillsTypes.Skill;

  type Tool = toolsTypes.Tool;
}

export type { sdkTypes as default };
