import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { EventBus } from "../event-bus.ts";
import type { ExecOptions, ExecResult } from "../exec.ts";
import type { CustomMessage } from "../messages.ts";
import type { Settings } from "../settings-manager.ts";
import type { SlashCommandInfo } from "../slash-commands.ts";
import type { ToolInfo } from "./types-runtime.ts";

export interface ExtensionSessionApi {
  sendMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void;

  sendUserMessage(
    content: string | (aiTypes.TextContent | aiTypes.ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): void;

  appendEntry<T = unknown>(customType: string, data?: T): void;

  setSessionName(name: string): void;

  getSessionName(): string | undefined;

  setLabel(entryId: string, label: string | undefined): void;

  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;

  getActiveTools(): string[];

  getAllTools(): ToolInfo[];

  getSettings(): Settings;

  setActiveTools(toolNames: string[]): void;

  getCommands(): SlashCommandInfo[];

  setModel(model: aiTypes.Model<any>): Promise<boolean>;

  getThinkingLevel(): agentTypes.ThinkingLevel;

  setThinkingLevel(level: agentTypes.ThinkingLevel): void;

  events: EventBus;
}
