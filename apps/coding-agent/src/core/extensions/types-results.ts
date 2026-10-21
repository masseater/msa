import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type bashExecutorTypes from "../bash-executor.types.ts";
import type cacheWarmerTypes from "../cache-warmer.types.ts";
import type compactionTypes from "../compaction/index.types.ts";
import type messagesTypes from "../messages.types.ts";
import type bashTypes from "../tools/bash.types.ts";
import type typesAgentEventsTypes from "./types-agent-events.ts";
import type typesSessionEventsTypes from "./types-session-events.ts";

declare namespace typesResultsTypes {
  type ExtensionEvent =
    | typesSessionEventsTypes.ProjectTrustEvent
    | typesSessionEventsTypes.ResourcesDiscoverEvent
    | typesSessionEventsTypes.McpServersChangeEvent
    | typesSessionEventsTypes.SessionEvent
    | typesSessionEventsTypes.ContextEvent
    | typesSessionEventsTypes.ContextWithSystemEvent
    | cacheWarmerTypes.CacheWarmingDecisionEvent
    | typesSessionEventsTypes.BeforeProviderRequestEvent
    | typesSessionEventsTypes.BeforeProviderHeadersEvent
    | typesSessionEventsTypes.AfterProviderResponseEvent
    | typesSessionEventsTypes.ProviderStreamEvent
    | typesSessionEventsTypes.BeforeAgentStartEvent
    | typesSessionEventsTypes.AgentStartEvent
    | typesSessionEventsTypes.AgentEndEvent
    | typesSessionEventsTypes.AgentBeforeSettleEvent
    | typesSessionEventsTypes.AgentSettledEvent
    | typesSessionEventsTypes.UIPromptStartEvent
    | typesSessionEventsTypes.UIPromptEndEvent
    | typesAgentEventsTypes.TurnStartEvent
    | typesAgentEventsTypes.TurnEndEvent
    | typesAgentEventsTypes.MessageStartEvent
    | typesAgentEventsTypes.MessageUpdateEvent
    | typesAgentEventsTypes.MessageEndEvent
    | typesAgentEventsTypes.ToolExecutionStartEvent
    | typesAgentEventsTypes.ToolExecutionUpdateEvent
    | typesAgentEventsTypes.ToolExecutionEndEvent
    | typesAgentEventsTypes.ModelSelectEvent
    | typesAgentEventsTypes.ThinkingLevelSelectEvent
    | typesAgentEventsTypes.UserBashEvent
    | typesAgentEventsTypes.InputEvent
    | typesAgentEventsTypes.ToolCallEvent
    | typesAgentEventsTypes.ToolResultEvent;

  interface ContextEventResult {
    messages?: agentTypes.AgentMessage[];
  }

  type TurnEndEventResult = typesSessionEventsTypes.BoundaryResult;

  type AgentBeforeSettleEventResult = typesSessionEventsTypes.BoundaryResult;

  type BeforeProviderRequestEventResult = unknown;

  interface ToolCallEventResult {
    block?: boolean;
    reason?: string;
    terminate?: boolean;
  }

  type UserBashEventResult =
    | {
        operations: bashTypes.BashOperations;
        result?: never;
      }
    | {
        operations?: never;
        result: bashExecutorTypes.BashResult;
      };

  interface ToolResultEventResult {
    content?: (aiTypes.TextContent | aiTypes.ImageContent)[] | undefined;
    details?: unknown;
    structuredContent?: aiTypes.JsonValue | undefined;
    isError?: boolean | undefined;
    usage?: aiTypes.Usage | undefined;
  }

  interface MessageEndEventResult {
    message?: agentTypes.AgentMessage;
  }

  interface BeforeAgentStartEventResult {
    message?: Pick<messagesTypes.CustomMessage, "customType" | "content" | "display" | "details">;
    systemPrompt?: string;
  }

  interface SessionBeforeSwitchResult {
    cancel?: boolean;
  }

  interface SessionBeforeForkResult {
    cancel?: boolean;
    skipConversationRestore?: boolean;
  }

  interface SessionBeforeCompactResult {
    cancel?: boolean;
    compaction?: compactionTypes.CompactionResult;
  }

  interface SessionBeforeTreeResult {
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

  type CacheWarmingDecisionEvent = cacheWarmerTypes.CacheWarmingDecisionEvent;

  type CacheWarmingDecisionEventResult = cacheWarmerTypes.CacheWarmingDecisionEventResult;
}

export type { typesResultsTypes as default };
