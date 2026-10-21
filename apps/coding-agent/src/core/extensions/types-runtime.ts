import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type messagesTypes from "../messages.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type slashCommandsTypes from "../slash-commands.types.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import type typesToolsTypes from "./types-tools.types.ts";

declare namespace typesRuntimeTypes {
  type HandlerFn = (...args: unknown[]) => Promise<unknown>;

  type SendMessageHandler = <T = unknown>(
    message: Pick<messagesTypes.CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ) => void;

  type SendUserMessageHandler = (
    content: string | (aiTypes.TextContent | aiTypes.ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ) => void;

  type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void;

  type SetSessionNameHandler = (name: string) => void;

  type GetSessionNameHandler = () => string | undefined;

  type GetActiveToolsHandler = () => string[];

  type ToolInfo = Pick<
    typesToolsTypes.ToolDefinition,
    "name" | "description" | "parameters" | "promptGuidelines" | "reachesTools"
  > & {
    exposure: typesToolsTypes.ToolExposure;
    namespace?: typesToolsTypes.ToolNamespace;
    annotations?: typesToolsTypes.ToolAnnotations;
    sourceInfo: sourceInfoTypes.SourceInfo;
  };

  type GetAllToolsHandler = () => ToolInfo[];

  type GetSettingsHandler = () => settingsManagerTypes.Settings;

  type GetCommandsHandler = () => slashCommandsTypes.SlashCommandInfo[];

  type SetActiveToolsHandler = (toolNames: string[]) => void;

  type RefreshToolsHandler = () => void;

  type SetModelHandler = (model: aiTypes.Model<any>) => Promise<boolean>;

  type GetThinkingLevelHandler = () => agentTypes.ThinkingLevel;

  type SetThinkingLevelHandler = (level: agentTypes.ThinkingLevel) => void;

  type SetLabelHandler = (entryId: string, label: string | undefined) => void;
}

export type { typesRuntimeTypes as default };
