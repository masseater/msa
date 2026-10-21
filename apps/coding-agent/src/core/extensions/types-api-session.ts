import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type eventBusTypes from "../event-bus.types.ts";
import type execTypes from "../exec.types.ts";
import type messagesTypes from "../messages.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type slashCommandsTypes from "../slash-commands.types.ts";
import type typesRuntimeTypes from "./types-runtime.ts";

declare namespace typesApiSessionTypes {
  interface ExtensionSessionApi {
    sendMessage<T = unknown>(
      message: Pick<
        messagesTypes.CustomMessage<T>,
        "customType" | "content" | "display" | "details"
      >,
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

    exec(
      command: string,
      args: string[],
      options?: execTypes.ExecOptions,
    ): Promise<execTypes.ExecResult>;

    getActiveTools(): string[];

    getAllTools(): typesRuntimeTypes.ToolInfo[];

    getSettings(): settingsManagerTypes.Settings;

    setActiveTools(toolNames: string[]): void;

    getCommands(): slashCommandsTypes.SlashCommandInfo[];

    setModel(model: aiTypes.Model<any>): Promise<boolean>;

    getThinkingLevel(): agentTypes.ThinkingLevel;

    setThinkingLevel(level: agentTypes.ThinkingLevel): void;

    events: eventBusTypes.EventBus;
  }
}

export type { typesApiSessionTypes as default };
