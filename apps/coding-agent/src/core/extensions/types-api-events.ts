import type {
  CacheWarmingDecisionEvent,
  CacheWarmingDecisionEventResult,
} from "../cache-warmer.ts";
import type {
  InputEvent,
  InputEventResult,
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
import type { ExtensionHandler } from "./types-render.ts";
import type {
  AgentBeforeSettleEventResult,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEventResult,
  ContextEventResult,
  MessageEndEventResult,
  SessionBeforeCompactResult,
  SessionBeforeForkResult,
  SessionBeforeSwitchResult,
  SessionBeforeTreeResult,
  ToolCallEventResult,
  ToolResultEventResult,
  TurnEndEventResult,
  UserBashEventResult,
} from "./types-results.ts";
import type {
  AfterProviderResponseEvent,
  AgentBeforeSettleEvent,
  AgentEndEvent,
  AgentSettledEvent,
  AgentStartEvent,
  BeforeAgentStartEvent,
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  ContextEvent,
  ContextWithSystemEvent,
  McpServersChangeEvent,
  ProjectTrustHandler,
  ProviderStreamEvent,
  ResourcesDiscoverEvent,
  ResourcesDiscoverResult,
  SessionBeforeCompactEvent,
  SessionBeforeForkEvent,
  SessionBeforeSwitchEvent,
  SessionBeforeTreeEvent,
  SessionCompactEvent,
  SessionCompactFailedEvent,
  SessionInfoChangedEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  SessionTreeEvent,
  UIPromptEndEvent,
  UIPromptStartEvent,
} from "./types-session-events.ts";

export interface ExtensionEventApi {
  on(event: "project_trust", handler: ProjectTrustHandler): () => void;
  on(
    event: "resources_discover",
    handler: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult>,
  ): () => void;
  on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): () => void;
  on(event: "session_info_changed", handler: ExtensionHandler<SessionInfoChangedEvent>): () => void;
  on(
    event: "session_before_switch",
    handler: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>,
  ): () => void;
  on(
    event: "session_before_fork",
    handler: ExtensionHandler<SessionBeforeForkEvent, SessionBeforeForkResult>,
  ): () => void;
  on(
    event: "session_before_compact",
    handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
  ): () => void;
  on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): () => void;
  on(
    event: "session_compact_failed",
    handler: ExtensionHandler<SessionCompactFailedEvent>,
  ): () => void;
  on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): () => void;
  on(event: "mcp_servers_change", handler: ExtensionHandler<McpServersChangeEvent>): () => void;
  on(
    event: "session_before_tree",
    handler: ExtensionHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult>,
  ): () => void;
  on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): () => void;
  on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): () => void;
  on(
    event: "context_with_system",
    handler: ExtensionHandler<ContextWithSystemEvent, ContextEventResult>,
  ): () => void;
  on(
    event: "cache_warming_decision",
    handler: ExtensionHandler<CacheWarmingDecisionEvent, CacheWarmingDecisionEventResult>,
  ): () => void;
  on(
    event: "before_provider_request",
    handler: ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestEventResult>,
  ): () => void;
  on(
    event: "before_provider_headers",
    handler: ExtensionHandler<BeforeProviderHeadersEvent>,
  ): () => void;
  on(
    event: "after_provider_response",
    handler: ExtensionHandler<AfterProviderResponseEvent>,
  ): () => void;
  on(event: "provider_stream_event", handler: ExtensionHandler<ProviderStreamEvent>): () => void;
  on(
    event: "before_agent_start",
    handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
  ): () => void;
  on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): () => void;
  on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): () => void;
  on(
    event: "agent_before_settle",
    handler: ExtensionHandler<AgentBeforeSettleEvent, AgentBeforeSettleEventResult>,
  ): () => void;
  on(event: "agent_settled", handler: ExtensionHandler<AgentSettledEvent>): () => void;
  on(event: "ui_prompt_start", handler: ExtensionHandler<UIPromptStartEvent>): () => void;
  on(event: "ui_prompt_end", handler: ExtensionHandler<UIPromptEndEvent>): () => void;
  on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): () => void;
  on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent, TurnEndEventResult>): () => void;
  on(event: "message_start", handler: ExtensionHandler<MessageStartEvent>): () => void;
  on(event: "message_update", handler: ExtensionHandler<MessageUpdateEvent>): () => void;
  on(
    event: "message_end",
    handler: ExtensionHandler<MessageEndEvent, MessageEndEventResult>,
  ): () => void;
  on(event: "tool_execution_start", handler: ExtensionHandler<ToolExecutionStartEvent>): () => void;
  on(
    event: "tool_execution_update",
    handler: ExtensionHandler<ToolExecutionUpdateEvent>,
  ): () => void;
  on(event: "tool_execution_end", handler: ExtensionHandler<ToolExecutionEndEvent>): () => void;
  on(event: "model_select", handler: ExtensionHandler<ModelSelectEvent>): () => void;
  on(
    event: "thinking_level_select",
    handler: ExtensionHandler<ThinkingLevelSelectEvent>,
  ): () => void;
  on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): () => void;
  on(
    event: "tool_result",
    handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>,
  ): () => void;
  on(event: "user_bash", handler: ExtensionHandler<UserBashEvent, UserBashEventResult>): () => void;
  on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): () => void;
}
