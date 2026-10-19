import type { AgentMessage } from "@msa/agent-core";
import type { ImageContent, JsonValue, TextContent, Usage } from "@msa/ai";

import type { BashResult } from "../bash-executor.ts";
import type { CacheWarmingDecisionEvent } from "../cache-warmer.ts";
import type { CompactionResult } from "../compaction/index.ts";
import type { CustomMessage } from "../messages.ts";
import type { BashOperations } from "../tools/bash.ts";
import type {
  InputEvent,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  ModelSelectEvent,
  ThinkingLevelSelectEvent,
  ToolCallEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolResultEvent,
  TurnEndEvent,
  TurnStartEvent,
  UserBashEvent,
} from "./types-agent-events.ts";
import type {
  AfterProviderResponseEvent,
  AgentBeforeSettleEvent,
  AgentEndEvent,
  AgentSettledEvent,
  AgentStartEvent,
  BeforeAgentStartEvent,
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  BoundaryResult,
  ContextEvent,
  ContextWithSystemEvent,
  McpServersChangeEvent,
  ProjectTrustEvent,
  ProviderStreamEvent,
  ResourcesDiscoverEvent,
  SessionEvent,
  UIPromptEndEvent,
  UIPromptStartEvent,
} from "./types-session-events.ts";

export type ExtensionEvent =
  | ProjectTrustEvent
  | ResourcesDiscoverEvent
  | McpServersChangeEvent
  | SessionEvent
  | ContextEvent
  | ContextWithSystemEvent
  | CacheWarmingDecisionEvent
  | BeforeProviderRequestEvent
  | BeforeProviderHeadersEvent
  | AfterProviderResponseEvent
  | ProviderStreamEvent
  | BeforeAgentStartEvent
  | AgentStartEvent
  | AgentEndEvent
  | AgentBeforeSettleEvent
  | AgentSettledEvent
  | UIPromptStartEvent
  | UIPromptEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | ModelSelectEvent
  | ThinkingLevelSelectEvent
  | UserBashEvent
  | InputEvent
  | ToolCallEvent
  | ToolResultEvent;

export interface ContextEventResult {
  messages?: AgentMessage[];
}

export type TurnEndEventResult = BoundaryResult;
export type AgentBeforeSettleEventResult = BoundaryResult;

export type BeforeProviderRequestEventResult = unknown;

export type {
  CacheWarmingDecisionEvent,
  CacheWarmingDecisionEventResult,
} from "../cache-warmer.ts";

export interface ToolCallEventResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}

export type UserBashEventResult =
  | {
      operations: BashOperations;
      result?: never;
    }
  | {
      operations?: never;
      result: BashResult;
    };

export interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[] | undefined;
  details?: unknown;
  structuredContent?: JsonValue | undefined;
  isError?: boolean | undefined;
  usage?: Usage | undefined;
}

export interface MessageEndEventResult {
  message?: AgentMessage;
}

export interface BeforeAgentStartEventResult {
  message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">;
  systemPrompt?: string;
}

export interface SessionBeforeSwitchResult {
  cancel?: boolean;
}

export interface SessionBeforeForkResult {
  cancel?: boolean;
  skipConversationRestore?: boolean;
}

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactionResult;
}

export interface SessionBeforeTreeResult {
  cancel?: boolean;
  summary?: {
    summary: string;
    details?: unknown;
    usage?: Usage;
  };
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}
