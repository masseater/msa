import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type execTypes from "../exec.types.ts";
import type keybindingsTypes from "../keybindings.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import type typesActionsTypes from "./types-actions.ts";
import type typesAgentEventsTypes from "./types-agent-events.ts";
import type typesApiTypes from "./types-api.ts";
import type typesContextActionsTypes from "./types-context-actions.ts";
import type typesContextTypes from "./types-context.ts";
import type typesExtensionTypes from "./types-extension.ts";
import type typesProviderTypes from "./types-provider.ts";
import type typesRenderTypes from "./types-render.ts";
import type typesResultsTypes from "./types-results.ts";
import type typesRuntimeTypes from "./types-runtime.ts";
import type typesSessionEventsTypes from "./types-session-events.ts";
import type typesToolsTypes from "./types-tools.types.ts";
import type typesUiTypes from "./types-ui.ts";

declare namespace extensionsTypesTypes {
  type AgentToolResult<T = aiTypes.JsonValue | undefined> = agentTypes.AgentToolResult<T>;

  type AgentToolUpdateCallback<T = any> = agentTypes.AgentToolUpdateCallback<T>;

  type ToolExecutionMode = agentTypes.ToolExecutionMode;

  type ExecOptions = execTypes.ExecOptions;

  type ExecResult = execTypes.ExecResult;

  type AppKeybinding = keybindingsTypes.AppKeybinding;

  type KeybindingsManager = keybindingsTypes.KeybindingsManager;

  type BuildSystemPromptOptions = systemPromptTypes.BuildSystemPromptOptions;

  type NormalizedBuildSystemPromptOptions = systemPromptTypes.NormalizedBuildSystemPromptOptions;

  type ExtensionRuntimeState = typesActionsTypes.ExtensionRuntimeState;

  type ExtensionActions = typesActionsTypes.ExtensionActions;

  type TurnStartEvent = typesAgentEventsTypes.TurnStartEvent;

  type TurnEndEvent = typesAgentEventsTypes.TurnEndEvent;

  type MessageStartEvent = typesAgentEventsTypes.MessageStartEvent;

  type MessageUpdateEvent = typesAgentEventsTypes.MessageUpdateEvent;

  type MessageEndEvent = typesAgentEventsTypes.MessageEndEvent;

  type ToolExecutionStartEvent = typesAgentEventsTypes.ToolExecutionStartEvent;

  type ToolExecutionUpdateEvent = typesAgentEventsTypes.ToolExecutionUpdateEvent;

  type ToolExecutionEndEvent = typesAgentEventsTypes.ToolExecutionEndEvent;

  type ModelSelectSource = typesAgentEventsTypes.ModelSelectSource;

  type ModelSelectEvent = typesAgentEventsTypes.ModelSelectEvent;

  type ThinkingLevelSelectEvent = typesAgentEventsTypes.ThinkingLevelSelectEvent;

  type UserBashEvent = typesAgentEventsTypes.UserBashEvent;

  type InputSource = typesAgentEventsTypes.InputSource;

  type InputEvent = typesAgentEventsTypes.InputEvent;

  type InputEventResult = typesAgentEventsTypes.InputEventResult;

  type BashToolCallEvent = typesAgentEventsTypes.BashToolCallEvent;

  type PowerShellToolCallEvent = typesAgentEventsTypes.PowerShellToolCallEvent;

  type ReadToolCallEvent = typesAgentEventsTypes.ReadToolCallEvent;

  type EditToolCallEvent = typesAgentEventsTypes.EditToolCallEvent;

  type WriteToolCallEvent = typesAgentEventsTypes.WriteToolCallEvent;

  type GrepToolCallEvent = typesAgentEventsTypes.GrepToolCallEvent;

  type FindToolCallEvent = typesAgentEventsTypes.FindToolCallEvent;

  type LsToolCallEvent = typesAgentEventsTypes.LsToolCallEvent;

  type CustomToolCallEvent = typesAgentEventsTypes.CustomToolCallEvent;

  type ToolCallEvent = typesAgentEventsTypes.ToolCallEvent;

  type BashToolResultEvent = typesAgentEventsTypes.BashToolResultEvent;

  type PowerShellToolResultEvent = typesAgentEventsTypes.PowerShellToolResultEvent;

  type ReadToolResultEvent = typesAgentEventsTypes.ReadToolResultEvent;

  type EditToolResultEvent = typesAgentEventsTypes.EditToolResultEvent;

  type WriteToolResultEvent = typesAgentEventsTypes.WriteToolResultEvent;

  type GrepToolResultEvent = typesAgentEventsTypes.GrepToolResultEvent;

  type FindToolResultEvent = typesAgentEventsTypes.FindToolResultEvent;

  type LsToolResultEvent = typesAgentEventsTypes.LsToolResultEvent;

  type CustomToolResultEvent = typesAgentEventsTypes.CustomToolResultEvent;

  type ToolResultEvent = typesAgentEventsTypes.ToolResultEvent;

  type ExtensionAPI = typesApiTypes.ExtensionAPI;

  type ExtensionContextActions = typesContextActionsTypes.ExtensionContextActions;

  type ExtensionCommandContextActions = typesContextActionsTypes.ExtensionCommandContextActions;

  type ExtensionRuntime = typesContextActionsTypes.ExtensionRuntime;

  type ExtensionContext = typesContextTypes.ExtensionContext;

  type ExecuteToolOptions = typesContextTypes.ExecuteToolOptions;

  type ExtensionToolContext = typesContextTypes.ExtensionToolContext;

  type ExtensionCommandContext = typesContextTypes.ExtensionCommandContext;

  type ReplacedSessionContext = typesContextTypes.ReplacedSessionContext;

  type Extension = typesExtensionTypes.Extension;

  type LoadExtensionsResult = typesExtensionTypes.LoadExtensionsResult;

  type ExtensionError = typesExtensionTypes.ExtensionError;

  type ExtensionVirtualModel<TState = unknown> = typesProviderTypes.ExtensionVirtualModel<TState>;

  type ProviderConfig = typesProviderTypes.ProviderConfig;

  type ProviderChatModelConfig = typesProviderTypes.ProviderChatModelConfig;

  type ProviderImageModelConfig = typesProviderTypes.ProviderImageModelConfig;

  type ProviderClassifierModelConfig = typesProviderTypes.ProviderClassifierModelConfig;

  type ProviderModelConfig = typesProviderTypes.ProviderModelConfig;

  type ExtensionFactory = typesProviderTypes.ExtensionFactory;

  type InlineExtension = typesProviderTypes.InlineExtension;

  type RegisteredTool = typesProviderTypes.RegisteredTool;

  type ExtensionFlag = typesProviderTypes.ExtensionFlag;

  type ExtensionShortcut = typesProviderTypes.ExtensionShortcut;

  type MessageRenderOptions = typesRenderTypes.MessageRenderOptions;

  type MarkdownTransformContext = typesRenderTypes.MarkdownTransformContext;

  type MarkdownTransformer = typesRenderTypes.MarkdownTransformer;

  type EntryRenderOptions = typesRenderTypes.EntryRenderOptions;

  type MessageRenderer<T = unknown> = typesRenderTypes.MessageRenderer<T>;

  type EntryRenderer<T = unknown> = typesRenderTypes.EntryRenderer<T>;

  type RegisteredCommand = typesRenderTypes.RegisteredCommand;

  type ResolvedCommand = typesRenderTypes.ResolvedCommand;

  type ExtensionHandler<E, R = undefined> = typesRenderTypes.ExtensionHandler<E, R>;

  type ExtensionEvent = typesResultsTypes.ExtensionEvent;

  type ContextEventResult = typesResultsTypes.ContextEventResult;

  type TurnEndEventResult = typesResultsTypes.TurnEndEventResult;

  type AgentBeforeSettleEventResult = typesResultsTypes.AgentBeforeSettleEventResult;

  type BeforeProviderRequestEventResult = typesResultsTypes.BeforeProviderRequestEventResult;

  type CacheWarmingDecisionEvent = typesResultsTypes.CacheWarmingDecisionEvent;

  type CacheWarmingDecisionEventResult = typesResultsTypes.CacheWarmingDecisionEventResult;

  type ToolCallEventResult = typesResultsTypes.ToolCallEventResult;

  type UserBashEventResult = typesResultsTypes.UserBashEventResult;

  type ToolResultEventResult = typesResultsTypes.ToolResultEventResult;

  type MessageEndEventResult = typesResultsTypes.MessageEndEventResult;

  type BeforeAgentStartEventResult = typesResultsTypes.BeforeAgentStartEventResult;

  type SessionBeforeSwitchResult = typesResultsTypes.SessionBeforeSwitchResult;

  type SessionBeforeForkResult = typesResultsTypes.SessionBeforeForkResult;

  type SessionBeforeCompactResult = typesResultsTypes.SessionBeforeCompactResult;

  type SessionBeforeTreeResult = typesResultsTypes.SessionBeforeTreeResult;

  type HandlerFn = typesRuntimeTypes.HandlerFn;

  type SendMessageHandler = typesRuntimeTypes.SendMessageHandler;

  type SendUserMessageHandler = typesRuntimeTypes.SendUserMessageHandler;

  type AppendEntryHandler = typesRuntimeTypes.AppendEntryHandler;

  type SetSessionNameHandler = typesRuntimeTypes.SetSessionNameHandler;

  type GetSessionNameHandler = typesRuntimeTypes.GetSessionNameHandler;

  type GetActiveToolsHandler = typesRuntimeTypes.GetActiveToolsHandler;

  type ToolInfo = typesRuntimeTypes.ToolInfo;

  type GetAllToolsHandler = typesRuntimeTypes.GetAllToolsHandler;

  type GetSettingsHandler = typesRuntimeTypes.GetSettingsHandler;

  type GetCommandsHandler = typesRuntimeTypes.GetCommandsHandler;

  type SetActiveToolsHandler = typesRuntimeTypes.SetActiveToolsHandler;

  type RefreshToolsHandler = typesRuntimeTypes.RefreshToolsHandler;

  type SetModelHandler = typesRuntimeTypes.SetModelHandler;

  type GetThinkingLevelHandler = typesRuntimeTypes.GetThinkingLevelHandler;

  type SetThinkingLevelHandler = typesRuntimeTypes.SetThinkingLevelHandler;

  type SetLabelHandler = typesRuntimeTypes.SetLabelHandler;

  type ProjectTrustEvent = typesSessionEventsTypes.ProjectTrustEvent;

  type ProjectTrustEventDecision = typesSessionEventsTypes.ProjectTrustEventDecision;

  type ProjectTrustEventResult = typesSessionEventsTypes.ProjectTrustEventResult;

  type ProjectTrustContext = typesSessionEventsTypes.ProjectTrustContext;

  type ProjectTrustHandler = typesSessionEventsTypes.ProjectTrustHandler;

  type ResourcesDiscoverEvent = typesSessionEventsTypes.ResourcesDiscoverEvent;

  type ResourcesDiscoverResult = typesSessionEventsTypes.ResourcesDiscoverResult;

  type McpServersChangeEvent = typesSessionEventsTypes.McpServersChangeEvent;

  type SessionStartEvent = typesSessionEventsTypes.SessionStartEvent;

  type SessionInfoChangedEvent = typesSessionEventsTypes.SessionInfoChangedEvent;

  type SessionBeforeSwitchEvent = typesSessionEventsTypes.SessionBeforeSwitchEvent;

  type SessionBeforeForkEvent = typesSessionEventsTypes.SessionBeforeForkEvent;

  type SessionBeforeCompactEvent = typesSessionEventsTypes.SessionBeforeCompactEvent;

  type SessionCompactEvent = typesSessionEventsTypes.SessionCompactEvent;

  type SessionCompactFailedEvent = typesSessionEventsTypes.SessionCompactFailedEvent;

  type SessionShutdownEvent = typesSessionEventsTypes.SessionShutdownEvent;

  type TreePreparation = typesSessionEventsTypes.TreePreparation;

  type SessionBeforeTreeEvent = typesSessionEventsTypes.SessionBeforeTreeEvent;

  type SessionTreeEvent = typesSessionEventsTypes.SessionTreeEvent;

  type SessionEvent = typesSessionEventsTypes.SessionEvent;

  type ContextEvent = typesSessionEventsTypes.ContextEvent;

  type ContextWithSystemEvent = typesSessionEventsTypes.ContextWithSystemEvent;

  type BeforeProviderRequestEvent = typesSessionEventsTypes.BeforeProviderRequestEvent;

  type BeforeProviderHeadersEvent = typesSessionEventsTypes.BeforeProviderHeadersEvent;

  type AfterProviderResponseEvent = typesSessionEventsTypes.AfterProviderResponseEvent;

  type ProviderStreamEvent = typesSessionEventsTypes.ProviderStreamEvent;

  type BeforeAgentStartUserEvent = typesSessionEventsTypes.BeforeAgentStartUserEvent;

  type BeforeAgentStartCustomEvent = typesSessionEventsTypes.BeforeAgentStartCustomEvent;

  type BeforeAgentStartEvent = typesSessionEventsTypes.BeforeAgentStartEvent;

  type AgentStartEvent = typesSessionEventsTypes.AgentStartEvent;

  type AgentEndEvent = typesSessionEventsTypes.AgentEndEvent;

  type AgentActivityOutcome = typesSessionEventsTypes.AgentActivityOutcome;

  type CustomEntryDraft = typesSessionEventsTypes.CustomEntryDraft;

  type CustomMessageEntryDraft = typesSessionEventsTypes.CustomMessageEntryDraft;

  type ContextEditEntryDraft = typesSessionEventsTypes.ContextEditEntryDraft;

  type CompactionEntryDraft = typesSessionEventsTypes.CompactionEntryDraft;

  type SessionBoundaryDraft = typesSessionEventsTypes.SessionBoundaryDraft;

  type BoundaryContextPreview = typesSessionEventsTypes.BoundaryContextPreview;

  type BoundaryState = typesSessionEventsTypes.BoundaryState;

  type BoundaryResult = typesSessionEventsTypes.BoundaryResult;

  type AgentBeforeSettleEvent = typesSessionEventsTypes.AgentBeforeSettleEvent;

  type AgentSettledEvent = typesSessionEventsTypes.AgentSettledEvent;

  type UIPromptKind = typesSessionEventsTypes.UIPromptKind;

  type UIPromptStartEvent = typesSessionEventsTypes.UIPromptStartEvent;

  type UIPromptEndEvent = typesSessionEventsTypes.UIPromptEndEvent;

  type ToolRenderResultOptions = typesToolsTypes.ToolRenderResultOptions;

  type ToolRenderContext<TState = any, TArgs = any> = typesToolsTypes.ToolRenderContext<
    TState,
    TArgs
  >;

  type ToolExposure = typesToolsTypes.ToolExposure;

  type ToolAnnotations = typesToolsTypes.ToolAnnotations;

  type ToolNamespace = typesToolsTypes.ToolNamespace;

  type ToolLoadout = typesToolsTypes.ToolLoadout;

  type ToolLoadoutChanges = typesToolsTypes.ToolLoadoutChanges;

  type ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
    TState = any,
  > = typesToolsTypes.ToolDefinition<TParams, TDetails, TState>;

  type ToolRenderers = typesToolsTypes.ToolRenderers;

  type ToolRendererResolver = typesToolsTypes.ToolRendererResolver;

  type ExtensionUIDialogOptions = typesUiTypes.ExtensionUIDialogOptions;

  type WidgetPlacement = typesUiTypes.WidgetPlacement;

  type ExtensionWidgetOptions = typesUiTypes.ExtensionWidgetOptions;

  type TerminalInputHandler = typesUiTypes.TerminalInputHandler;

  type WorkingIndicatorOptions = typesUiTypes.WorkingIndicatorOptions;

  type AutocompleteProviderFactory = typesUiTypes.AutocompleteProviderFactory;

  type EditorFactory = typesUiTypes.EditorFactory;

  type ExtensionUIContext = typesUiTypes.ExtensionUIContext;

  type ContextUsage = typesUiTypes.ContextUsage;

  type CompactOptions = typesUiTypes.CompactOptions;

  type ExtensionMode = typesUiTypes.ExtensionMode;
}

export type { extensionsTypesTypes as default };
