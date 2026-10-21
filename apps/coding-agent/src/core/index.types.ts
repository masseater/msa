import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import type bashExecutorTypes from "./bash-executor.types.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type compactionTypes from "./compaction/index.types.ts";
import type eventBusTypes from "./event-bus.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";

declare namespace coreTypes {
  type AgentSession = agentSessionTypes.AgentSession;

  type AgentSessionConfig = agentSessionTypes.AgentSessionConfig;

  type AgentSessionEvent = agentSessionTypes.AgentSessionEvent;

  type AgentSessionEventListener = agentSessionTypes.AgentSessionEventListener;

  type ModelCycleResult = agentSessionTypes.ModelCycleResult;

  type PromptOptions = agentSessionTypes.PromptOptions;

  type SessionStats = agentSessionTypes.SessionStats;

  type AgentSessionRuntime = agentSessionRuntimeTypes.AgentSessionRuntime;

  type CreateAgentSessionRuntimeFactory = agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory;

  type CreateAgentSessionRuntimeResult = agentSessionRuntimeTypes.CreateAgentSessionRuntimeResult;

  type AgentSessionRuntimeDiagnostic = agentSessionServicesTypes.AgentSessionRuntimeDiagnostic;

  type AgentSessionServices = agentSessionServicesTypes.AgentSessionServices;

  type CreateAgentSessionFromServicesOptions =
    agentSessionServicesTypes.CreateAgentSessionFromServicesOptions;

  type CreateAgentSessionServicesOptions =
    agentSessionServicesTypes.CreateAgentSessionServicesOptions;

  type BashExecutorOptions = bashExecutorTypes.BashExecutorOptions;

  type BashResult = bashExecutorTypes.BashResult;

  type CacheWarmingDecision = cacheWarmerTypes.CacheWarmingDecision;

  type CacheWarmingStatus = cacheWarmerTypes.CacheWarmingStatus;

  type CompactionResult<T = unknown> = compactionTypes.CompactionResult<T>;

  type EventBus = eventBusTypes.EventBus;

  type EventBusController = eventBusTypes.EventBusController;

  type AgentActivityOutcome = extensionsTypes.AgentActivityOutcome;

  type AgentBeforeSettleEvent = extensionsTypes.AgentBeforeSettleEvent;

  type AgentBeforeSettleEventResult = extensionsTypes.AgentBeforeSettleEventResult;

  type AgentEndEvent = extensionsTypes.AgentEndEvent;

  type AgentSettledEvent = extensionsTypes.AgentSettledEvent;

  type AgentStartEvent = extensionsTypes.AgentStartEvent;

  type AgentToolResult<T = aiTypes.JsonValue | undefined> = extensionsTypes.AgentToolResult<T>;

  type AgentToolUpdateCallback<T = any> = extensionsTypes.AgentToolUpdateCallback<T>;

  type BeforeAgentStartEvent = extensionsTypes.BeforeAgentStartEvent;

  type BeforeAgentStartEventResult = extensionsTypes.BeforeAgentStartEventResult;

  type BoundaryContextPreview = extensionsTypes.BoundaryContextPreview;

  type BoundaryResult = extensionsTypes.BoundaryResult;

  type BoundaryState = extensionsTypes.BoundaryState;

  type BuildSystemPromptOptions = extensionsTypes.BuildSystemPromptOptions;

  type CacheWarmingDecisionEvent = extensionsTypes.CacheWarmingDecisionEvent;

  type CacheWarmingDecisionEventResult = extensionsTypes.CacheWarmingDecisionEventResult;

  type CompactionEntryDraft = extensionsTypes.CompactionEntryDraft;

  type ContextEditEntryDraft = extensionsTypes.ContextEditEntryDraft;

  type ContextEvent = extensionsTypes.ContextEvent;

  type ContextWithSystemEvent = extensionsTypes.ContextWithSystemEvent;

  type CustomEntryDraft = extensionsTypes.CustomEntryDraft;

  type CustomMessageEntryDraft = extensionsTypes.CustomMessageEntryDraft;

  type ExecOptions = extensionsTypes.ExecOptions;

  type ExecResult = extensionsTypes.ExecResult;

  type Extension = extensionsTypes.Extension;

  type ExtensionAPI = extensionsTypes.ExtensionAPI;

  type ExtensionCommandContext = extensionsTypes.ExtensionCommandContext;

  type ExtensionContext = extensionsTypes.ExtensionContext;

  type ExtensionError = extensionsTypes.ExtensionError;

  type ExtensionEvent = extensionsTypes.ExtensionEvent;

  type ExtensionFactory = extensionsTypes.ExtensionFactory;

  type ExtensionFlag = extensionsTypes.ExtensionFlag;

  type ExtensionHandler<E, R = undefined> = extensionsTypes.ExtensionHandler<E, R>;

  type ExtensionRunner = extensionsTypes.ExtensionRunner;

  type ExtensionShortcut = extensionsTypes.ExtensionShortcut;

  type ExtensionUIContext = extensionsTypes.ExtensionUIContext;

  type InlineExtension = extensionsTypes.InlineExtension;

  type LoadExtensionsResult = extensionsTypes.LoadExtensionsResult;

  type MessageRenderer<T = unknown> = extensionsTypes.MessageRenderer<T>;

  type NormalizedBuildSystemPromptOptions = extensionsTypes.NormalizedBuildSystemPromptOptions;

  type RegisteredCommand = extensionsTypes.RegisteredCommand;

  type SessionBeforeCompactEvent = extensionsTypes.SessionBeforeCompactEvent;

  type SessionBeforeForkEvent = extensionsTypes.SessionBeforeForkEvent;

  type SessionBeforeSwitchEvent = extensionsTypes.SessionBeforeSwitchEvent;

  type SessionBeforeTreeEvent = extensionsTypes.SessionBeforeTreeEvent;

  type SessionBoundaryDraft = extensionsTypes.SessionBoundaryDraft;

  type SessionCompactEvent = extensionsTypes.SessionCompactEvent;

  type SessionShutdownEvent = extensionsTypes.SessionShutdownEvent;

  type SessionStartEvent = extensionsTypes.SessionStartEvent;

  type SessionTreeEvent = extensionsTypes.SessionTreeEvent;

  type ToolCallEvent = extensionsTypes.ToolCallEvent;

  type ToolCallEventResult = extensionsTypes.ToolCallEventResult;

  type ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
    TState = any,
  > = extensionsTypes.ToolDefinition<TParams, TDetails, TState>;

  type ToolRenderResultOptions = extensionsTypes.ToolRenderResultOptions;

  type ToolResultEvent = extensionsTypes.ToolResultEvent;

  type TurnEndEvent = extensionsTypes.TurnEndEvent;

  type TurnEndEventResult = extensionsTypes.TurnEndEventResult;

  type TurnStartEvent = extensionsTypes.TurnStartEvent;

  type WorkingIndicatorOptions = extensionsTypes.WorkingIndicatorOptions;
}

export type { coreTypes as default };
