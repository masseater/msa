import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

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
  messages?: agentTypes.AgentMessage[];
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
  content?: (aiTypes.TextContent | aiTypes.ImageContent)[] | undefined;
  details?: unknown;
  structuredContent?: aiTypes.JsonValue | undefined;
  isError?: boolean | undefined;
  usage?: aiTypes.Usage | undefined;
}

export interface MessageEndEventResult {
  message?: agentTypes.AgentMessage;
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
    usage?: aiTypes.Usage;
  };
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}
