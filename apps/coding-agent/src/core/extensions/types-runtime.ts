import type { ThinkingLevel } from "@msa/agent-core";
import type { ImageContent, Model, TextContent } from "@msa/ai";

import type { CustomMessage } from "../messages.ts";
import type { Settings } from "../settings-manager.ts";
import type { SlashCommandInfo } from "../slash-commands.ts";
import type { SourceInfo } from "../source-info.ts";
import type {
  ToolAnnotations,
  ToolDefinition,
  ToolExposure,
  ToolNamespace,
} from "./types-tools.ts";

export type HandlerFn = (...args: unknown[]) => Promise<unknown>;

export type SendMessageHandler = <T = unknown>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

export type SendUserMessageHandler = (
  content: string | (TextContent | ImageContent)[],
  options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
) => void;

export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void;

export type SetSessionNameHandler = (name: string) => void;

export type GetSessionNameHandler = () => string | undefined;

export type GetActiveToolsHandler = () => string[];

export type ToolInfo = Pick<
  ToolDefinition,
  "name" | "description" | "parameters" | "promptGuidelines" | "reachesTools"
> & {
  exposure: ToolExposure;
  namespace?: ToolNamespace;
  annotations?: ToolAnnotations;
  sourceInfo: SourceInfo;
};

export type GetAllToolsHandler = () => ToolInfo[];

export type GetSettingsHandler = () => Settings;

export type GetCommandsHandler = () => SlashCommandInfo[];

export type SetActiveToolsHandler = (toolNames: string[]) => void;

export type RefreshToolsHandler = () => void;

export type SetModelHandler = (model: Model<any>) => Promise<boolean>;

export type GetThinkingLevelHandler = () => ThinkingLevel;

export type SetThinkingLevelHandler = (level: ThinkingLevel) => void;

export type SetLabelHandler = (entryId: string, label: string | undefined) => void;
