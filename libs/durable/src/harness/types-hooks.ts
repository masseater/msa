import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";

import type typesModule from "../types.types.ts";
import type typesToolsTypes from "./types-tools.ts";
import type typesModuleModule from "./types.types.ts";

declare namespace typesHooksTypes {
  interface HookApi extends typesModule.DocumentReader {
    readonly taskId: typesModule.TaskId;
    readonly conversationId: typesModule.ConversationId;
    readonly models: aiTypes.Models;
    memo<T extends chordTypes.JsonValue>(
      name: string,
      context: chordTypes.Context,
    ): Promise<T | undefined>;
    memo<T extends chordTypes.JsonValue>(
      name: string,
      candidate: T,
      context: chordTypes.Context,
    ): Promise<T>;
  }

  type HookResult<T> = T | undefined | Promise<T | undefined>;

  interface GenerationHooks {
    beforeRequest(
      request: { readonly messages: readonly aiTypes.Message[] },
      api: HookApi,
      context: chordTypes.Context,
    ): HookResult<{ readonly messages: readonly aiTypes.Message[] }>;
    afterResponse(
      message: aiTypes.AssistantMessage,
      api: HookApi,
      context: chordTypes.Context,
    ): void | Promise<void>;
    onYield(
      answer: aiTypes.AssistantMessage,
      api: HookApi,
      context: chordTypes.Context,
    ): HookResult<{ readonly continue: typesModuleModule.UserInput }>;
    afterTools(
      assistant: typesModule.EntryId,
      results: readonly typesModule.EntryId[],
      api: HookApi,
      context: chordTypes.Context,
    ): void | Promise<void>;
  }

  type ToolHookCall = aiTypes.ToolCall & {
    readonly parent?: { readonly taskId: typesModule.TaskId; readonly callId: string };
  };

  interface ToolHooks {
    beforeTool(
      call: ToolHookCall,
      api: HookApi,
      context: chordTypes.Context,
    ): HookResult<{ readonly arguments?: typesModule.JsonObject; readonly block?: string }>;
    afterTool(
      call: ToolHookCall,
      result: typesToolsTypes.ToolExecutionResult,
      api: HookApi,
      context: chordTypes.Context,
    ): HookResult<typesToolsTypes.ToolExecutionResult>;
  }

  interface CompactionHooks {
    beforeCompact(
      compaction: {
        readonly reason: typesModuleModule.CompactionReason;
        readonly entries: readonly typesModule.EntryRecord[];
        readonly messages: readonly aiTypes.Message[];
        readonly firstKept: typesModule.EntryId;
        readonly instructions?: string;
      },
      api: HookApi,
      context: chordTypes.Context,
    ): HookResult<{ readonly decline: true } | { readonly summary: string }>;
  }
}

export type { typesHooksTypes as default };
