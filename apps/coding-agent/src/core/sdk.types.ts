import type { TSchema } from "typebox";

import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type sdkOptionsTypes from "./sdk-options.types.ts";
import type skillsTypes from "./skills.types.ts";
import type toolsTypes from "./tools/index.types.ts";

declare namespace sdkTypes {
  type CreateAgentSessionOptions = sdkOptionsTypes.CreateAgentSessionOptions;

  type CreateAgentSessionResult = sdkOptionsTypes.CreateAgentSessionResult;

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
