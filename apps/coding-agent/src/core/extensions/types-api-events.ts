import type cacheWarmerTypes from "../cache-warmer.types.ts";
import type typesAgentEventsTypes from "./types-agent-events.ts";
import type typesRenderTypes from "./types-render.ts";
import type typesResultsTypes from "./types-results.ts";
import type typesSessionEventsTypes from "./types-session-events.ts";

declare namespace typesApiEventsTypes {
  interface ExtensionEventApi {
    on(event: "project_trust", handler: typesSessionEventsTypes.ProjectTrustHandler): () => void;
    on(
      event: "resources_discover",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.ResourcesDiscoverEvent,
        typesSessionEventsTypes.ResourcesDiscoverResult
      >,
    ): () => void;
    on(
      event: "session_start",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.SessionStartEvent>,
    ): () => void;
    on(
      event: "session_info_changed",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.SessionInfoChangedEvent>,
    ): () => void;
    on(
      event: "session_before_switch",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.SessionBeforeSwitchEvent,
        typesResultsTypes.SessionBeforeSwitchResult
      >,
    ): () => void;
    on(
      event: "session_before_fork",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.SessionBeforeForkEvent,
        typesResultsTypes.SessionBeforeForkResult
      >,
    ): () => void;
    on(
      event: "session_before_compact",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.SessionBeforeCompactEvent,
        typesResultsTypes.SessionBeforeCompactResult
      >,
    ): () => void;
    on(
      event: "session_compact",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.SessionCompactEvent>,
    ): () => void;
    on(
      event: "session_compact_failed",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.SessionCompactFailedEvent>,
    ): () => void;
    on(
      event: "session_shutdown",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.SessionShutdownEvent>,
    ): () => void;
    on(
      event: "mcp_servers_change",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.McpServersChangeEvent>,
    ): () => void;
    on(
      event: "session_before_tree",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.SessionBeforeTreeEvent,
        typesResultsTypes.SessionBeforeTreeResult
      >,
    ): () => void;
    on(
      event: "session_tree",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.SessionTreeEvent>,
    ): () => void;
    on(
      event: "context",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.ContextEvent,
        typesResultsTypes.ContextEventResult
      >,
    ): () => void;
    on(
      event: "context_with_system",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.ContextWithSystemEvent,
        typesResultsTypes.ContextEventResult
      >,
    ): () => void;
    on(
      event: "cache_warming_decision",
      handler: typesRenderTypes.ExtensionHandler<
        cacheWarmerTypes.CacheWarmingDecisionEvent,
        cacheWarmerTypes.CacheWarmingDecisionEventResult
      >,
    ): () => void;
    on(
      event: "before_provider_request",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.BeforeProviderRequestEvent,
        typesResultsTypes.BeforeProviderRequestEventResult
      >,
    ): () => void;
    on(
      event: "before_provider_headers",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.BeforeProviderHeadersEvent>,
    ): () => void;
    on(
      event: "after_provider_response",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.AfterProviderResponseEvent>,
    ): () => void;
    on(
      event: "provider_stream_event",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.ProviderStreamEvent>,
    ): () => void;
    on(
      event: "before_agent_start",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.BeforeAgentStartEvent,
        typesResultsTypes.BeforeAgentStartEventResult
      >,
    ): () => void;
    on(
      event: "agent_start",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.AgentStartEvent>,
    ): () => void;
    on(
      event: "agent_end",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.AgentEndEvent>,
    ): () => void;
    on(
      event: "agent_before_settle",
      handler: typesRenderTypes.ExtensionHandler<
        typesSessionEventsTypes.AgentBeforeSettleEvent,
        typesResultsTypes.AgentBeforeSettleEventResult
      >,
    ): () => void;
    on(
      event: "agent_settled",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.AgentSettledEvent>,
    ): () => void;
    on(
      event: "ui_prompt_start",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.UIPromptStartEvent>,
    ): () => void;
    on(
      event: "ui_prompt_end",
      handler: typesRenderTypes.ExtensionHandler<typesSessionEventsTypes.UIPromptEndEvent>,
    ): () => void;
    on(
      event: "turn_start",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.TurnStartEvent>,
    ): () => void;
    on(
      event: "turn_end",
      handler: typesRenderTypes.ExtensionHandler<
        typesAgentEventsTypes.TurnEndEvent,
        typesResultsTypes.TurnEndEventResult
      >,
    ): () => void;
    on(
      event: "message_start",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.MessageStartEvent>,
    ): () => void;
    on(
      event: "message_update",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.MessageUpdateEvent>,
    ): () => void;
    on(
      event: "message_end",
      handler: typesRenderTypes.ExtensionHandler<
        typesAgentEventsTypes.MessageEndEvent,
        typesResultsTypes.MessageEndEventResult
      >,
    ): () => void;
    on(
      event: "tool_execution_start",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.ToolExecutionStartEvent>,
    ): () => void;
    on(
      event: "tool_execution_update",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.ToolExecutionUpdateEvent>,
    ): () => void;
    on(
      event: "tool_execution_end",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.ToolExecutionEndEvent>,
    ): () => void;
    on(
      event: "model_select",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.ModelSelectEvent>,
    ): () => void;
    on(
      event: "thinking_level_select",
      handler: typesRenderTypes.ExtensionHandler<typesAgentEventsTypes.ThinkingLevelSelectEvent>,
    ): () => void;
    on(
      event: "tool_call",
      handler: typesRenderTypes.ExtensionHandler<
        typesAgentEventsTypes.ToolCallEvent,
        typesResultsTypes.ToolCallEventResult
      >,
    ): () => void;
    on(
      event: "tool_result",
      handler: typesRenderTypes.ExtensionHandler<
        typesAgentEventsTypes.ToolResultEvent,
        typesResultsTypes.ToolResultEventResult
      >,
    ): () => void;
    on(
      event: "user_bash",
      handler: typesRenderTypes.ExtensionHandler<
        typesAgentEventsTypes.UserBashEvent,
        typesResultsTypes.UserBashEventResult
      >,
    ): () => void;
    on(
      event: "input",
      handler: typesRenderTypes.ExtensionHandler<
        typesAgentEventsTypes.InputEvent,
        typesAgentEventsTypes.InputEventResult
      >,
    ): () => void;
  }
}

export type { typesApiEventsTypes as default };
