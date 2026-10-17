import type { AssistantMessage, Message, Models, ToolCall } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type {
  ConversationId,
  DocumentReader,
  EntryId,
  EntryRecord,
  JsonObject,
  TaskId,
} from "../types.ts";
import type { ToolExecutionResult } from "./types-tools.ts";
import type { CompactionReason, UserInput } from "./types.ts";

export interface HookApi extends DocumentReader {
  readonly taskId: TaskId;
  readonly conversationId: ConversationId;
  readonly models: Models;
  memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
  memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
}

export type HookResult<T> = T | undefined | Promise<T | undefined>;

export interface GenerationHooks {
  beforeRequest(
    request: { readonly messages: readonly Message[] },
    api: HookApi,
    context: Context,
  ): HookResult<{ readonly messages: readonly Message[] }>;
  afterResponse(message: AssistantMessage, api: HookApi, context: Context): void | Promise<void>;
  onYield(
    answer: AssistantMessage,
    api: HookApi,
    context: Context,
  ): HookResult<{ readonly continue: UserInput }>;
  afterTools(
    assistant: EntryId,
    results: readonly EntryId[],
    api: HookApi,
    context: Context,
  ): void | Promise<void>;
}

export type ToolHookCall = ToolCall & {
  readonly parent?: { readonly taskId: TaskId; readonly callId: string };
};

export interface ToolHooks {
  beforeTool(
    call: ToolHookCall,
    api: HookApi,
    context: Context,
  ): HookResult<{ readonly arguments?: JsonObject; readonly block?: string }>;
  afterTool(
    call: ToolHookCall,
    result: ToolExecutionResult,
    api: HookApi,
    context: Context,
  ): HookResult<ToolExecutionResult>;
}

export interface CompactionHooks {
  beforeCompact(
    compaction: {
      readonly reason: CompactionReason;
      readonly entries: readonly EntryRecord[];
      readonly messages: readonly Message[];
      readonly firstKept: EntryId;
      readonly instructions?: string;
    },
    api: HookApi,
    context: Context,
  ): HookResult<{ readonly decline: true } | { readonly summary: string }>;
}
