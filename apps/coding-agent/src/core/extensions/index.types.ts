import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type slashCommandsTypes from "../slash-commands.types.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import type runnerTypes from "./runner.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace extensionsTypes {
  type SlashCommandInfo = slashCommandsTypes.SlashCommandInfo;

  type SlashCommandSource = slashCommandsTypes.SlashCommandSource;

  type SourceInfo = sourceInfoTypes.SourceInfo;

  type ExtensionErrorListener = runnerTypes.ExtensionErrorListener;

  type ForkHandler = runnerTypes.ForkHandler;

  type NavigateTreeHandler = runnerTypes.NavigateTreeHandler;

  type NewSessionHandler = runnerTypes.NewSessionHandler;

  type ShutdownHandler = runnerTypes.ShutdownHandler;

  type SwitchSessionHandler = runnerTypes.SwitchSessionHandler;

  type ExtensionRunner = runnerTypes.ExtensionRunner;

  type AfterProviderResponseEvent = extensionsTypesTypes.AfterProviderResponseEvent;

  type AgentActivityOutcome = extensionsTypesTypes.AgentActivityOutcome;

  type AgentBeforeSettleEvent = extensionsTypesTypes.AgentBeforeSettleEvent;

  type AgentBeforeSettleEventResult = extensionsTypesTypes.AgentBeforeSettleEventResult;

  type AgentEndEvent = extensionsTypesTypes.AgentEndEvent;

  type AgentSettledEvent = extensionsTypesTypes.AgentSettledEvent;

  type AgentStartEvent = extensionsTypesTypes.AgentStartEvent;

  type AgentToolResult<T = aiTypes.JsonValue | undefined> = extensionsTypesTypes.AgentToolResult<T>;

  type AgentToolUpdateCallback<T = any> = extensionsTypesTypes.AgentToolUpdateCallback<T>;

  type AppendEntryHandler = extensionsTypesTypes.AppendEntryHandler;

  type AppKeybinding = extensionsTypesTypes.AppKeybinding;

  type AutocompleteProviderFactory = extensionsTypesTypes.AutocompleteProviderFactory;

  type BashToolCallEvent = extensionsTypesTypes.BashToolCallEvent;

  type BashToolResultEvent = extensionsTypesTypes.BashToolResultEvent;

  type BeforeAgentStartCustomEvent = extensionsTypesTypes.BeforeAgentStartCustomEvent;

  type BeforeAgentStartEvent = extensionsTypesTypes.BeforeAgentStartEvent;

  type BeforeAgentStartEventResult = extensionsTypesTypes.BeforeAgentStartEventResult;

  type BeforeAgentStartUserEvent = extensionsTypesTypes.BeforeAgentStartUserEvent;

  type BeforeProviderHeadersEvent = extensionsTypesTypes.BeforeProviderHeadersEvent;

  type BeforeProviderRequestEvent = extensionsTypesTypes.BeforeProviderRequestEvent;

  type BeforeProviderRequestEventResult = extensionsTypesTypes.BeforeProviderRequestEventResult;

  type BoundaryContextPreview = extensionsTypesTypes.BoundaryContextPreview;

  type BoundaryResult = extensionsTypesTypes.BoundaryResult;

  type BoundaryState = extensionsTypesTypes.BoundaryState;

  type BuildSystemPromptOptions = extensionsTypesTypes.BuildSystemPromptOptions;

  type CacheWarmingDecisionEvent = extensionsTypesTypes.CacheWarmingDecisionEvent;

  type CacheWarmingDecisionEventResult = extensionsTypesTypes.CacheWarmingDecisionEventResult;

  type CompactionEntryDraft = extensionsTypesTypes.CompactionEntryDraft;

  type CompactOptions = extensionsTypesTypes.CompactOptions;

  type ContextEditEntryDraft = extensionsTypesTypes.ContextEditEntryDraft;

  type ContextEvent = extensionsTypesTypes.ContextEvent;

  type ContextEventResult = extensionsTypesTypes.ContextEventResult;

  type ContextUsage = extensionsTypesTypes.ContextUsage;

  type ContextWithSystemEvent = extensionsTypesTypes.ContextWithSystemEvent;

  type CustomEntryDraft = extensionsTypesTypes.CustomEntryDraft;

  type CustomMessageEntryDraft = extensionsTypesTypes.CustomMessageEntryDraft;

  type CustomToolCallEvent = extensionsTypesTypes.CustomToolCallEvent;

  type CustomToolResultEvent = extensionsTypesTypes.CustomToolResultEvent;

  type EditorFactory = extensionsTypesTypes.EditorFactory;

  type EditToolCallEvent = extensionsTypesTypes.EditToolCallEvent;

  type EditToolResultEvent = extensionsTypesTypes.EditToolResultEvent;

  type EntryRenderer<T = unknown> = extensionsTypesTypes.EntryRenderer<T>;

  type EntryRenderOptions = extensionsTypesTypes.EntryRenderOptions;

  type ExecOptions = extensionsTypesTypes.ExecOptions;

  type ExecResult = extensionsTypesTypes.ExecResult;

  type ExecuteToolOptions = extensionsTypesTypes.ExecuteToolOptions;

  type Extension = extensionsTypesTypes.Extension;

  type ExtensionActions = extensionsTypesTypes.ExtensionActions;

  type ExtensionAPI = extensionsTypesTypes.ExtensionAPI;

  type ExtensionCommandContext = extensionsTypesTypes.ExtensionCommandContext;

  type ExtensionCommandContextActions = extensionsTypesTypes.ExtensionCommandContextActions;

  type ExtensionContext = extensionsTypesTypes.ExtensionContext;

  type ExtensionContextActions = extensionsTypesTypes.ExtensionContextActions;

  type ExtensionError = extensionsTypesTypes.ExtensionError;

  type ExtensionEvent = extensionsTypesTypes.ExtensionEvent;

  type ExtensionFactory = extensionsTypesTypes.ExtensionFactory;

  type ExtensionFlag = extensionsTypesTypes.ExtensionFlag;

  type ExtensionHandler<E, R = undefined> = extensionsTypesTypes.ExtensionHandler<E, R>;

  type ExtensionMode = extensionsTypesTypes.ExtensionMode;

  type ExtensionRuntime = extensionsTypesTypes.ExtensionRuntime;

  type ExtensionShortcut = extensionsTypesTypes.ExtensionShortcut;

  type ExtensionToolContext = extensionsTypesTypes.ExtensionToolContext;

  type ExtensionUIContext = extensionsTypesTypes.ExtensionUIContext;

  type ExtensionUIDialogOptions = extensionsTypesTypes.ExtensionUIDialogOptions;

  type ExtensionVirtualModel<TState = unknown> = extensionsTypesTypes.ExtensionVirtualModel<TState>;

  type ExtensionWidgetOptions = extensionsTypesTypes.ExtensionWidgetOptions;

  type FindToolCallEvent = extensionsTypesTypes.FindToolCallEvent;

  type FindToolResultEvent = extensionsTypesTypes.FindToolResultEvent;

  type GetActiveToolsHandler = extensionsTypesTypes.GetActiveToolsHandler;

  type GetAllToolsHandler = extensionsTypesTypes.GetAllToolsHandler;

  type GetCommandsHandler = extensionsTypesTypes.GetCommandsHandler;

  type GetThinkingLevelHandler = extensionsTypesTypes.GetThinkingLevelHandler;

  type GrepToolCallEvent = extensionsTypesTypes.GrepToolCallEvent;

  type GrepToolResultEvent = extensionsTypesTypes.GrepToolResultEvent;

  type InlineExtension = extensionsTypesTypes.InlineExtension;

  type InputEvent = extensionsTypesTypes.InputEvent;

  type InputEventResult = extensionsTypesTypes.InputEventResult;

  type InputSource = extensionsTypesTypes.InputSource;

  type KeybindingsManager = extensionsTypesTypes.KeybindingsManager;

  type LoadExtensionsResult = extensionsTypesTypes.LoadExtensionsResult;

  type LsToolCallEvent = extensionsTypesTypes.LsToolCallEvent;

  type LsToolResultEvent = extensionsTypesTypes.LsToolResultEvent;

  type MarkdownTransformContext = extensionsTypesTypes.MarkdownTransformContext;

  type MarkdownTransformer = extensionsTypesTypes.MarkdownTransformer;

  type McpServersChangeEvent = extensionsTypesTypes.McpServersChangeEvent;

  type MessageEndEvent = extensionsTypesTypes.MessageEndEvent;

  type MessageEndEventResult = extensionsTypesTypes.MessageEndEventResult;

  type MessageRenderer<T = unknown> = extensionsTypesTypes.MessageRenderer<T>;

  type MessageRenderOptions = extensionsTypesTypes.MessageRenderOptions;

  type MessageStartEvent = extensionsTypesTypes.MessageStartEvent;

  type MessageUpdateEvent = extensionsTypesTypes.MessageUpdateEvent;

  type ModelSelectEvent = extensionsTypesTypes.ModelSelectEvent;

  type ModelSelectSource = extensionsTypesTypes.ModelSelectSource;

  type NormalizedBuildSystemPromptOptions = extensionsTypesTypes.NormalizedBuildSystemPromptOptions;

  type PowerShellToolCallEvent = extensionsTypesTypes.PowerShellToolCallEvent;

  type PowerShellToolResultEvent = extensionsTypesTypes.PowerShellToolResultEvent;

  type ProjectTrustContext = extensionsTypesTypes.ProjectTrustContext;

  type ProjectTrustEvent = extensionsTypesTypes.ProjectTrustEvent;

  type ProjectTrustEventDecision = extensionsTypesTypes.ProjectTrustEventDecision;

  type ProjectTrustEventResult = extensionsTypesTypes.ProjectTrustEventResult;

  type ProjectTrustHandler = extensionsTypesTypes.ProjectTrustHandler;

  type ProviderConfig = extensionsTypesTypes.ProviderConfig;

  type ProviderModelConfig = extensionsTypesTypes.ProviderModelConfig;

  type ProviderStreamEvent = extensionsTypesTypes.ProviderStreamEvent;

  type ReadToolCallEvent = extensionsTypesTypes.ReadToolCallEvent;

  type ReadToolResultEvent = extensionsTypesTypes.ReadToolResultEvent;

  type RegisteredCommand = extensionsTypesTypes.RegisteredCommand;

  type RegisteredTool = extensionsTypesTypes.RegisteredTool;

  type ReplacedSessionContext = extensionsTypesTypes.ReplacedSessionContext;

  type ResolvedCommand = extensionsTypesTypes.ResolvedCommand;

  type ResourcesDiscoverEvent = extensionsTypesTypes.ResourcesDiscoverEvent;

  type ResourcesDiscoverResult = extensionsTypesTypes.ResourcesDiscoverResult;

  type SendMessageHandler = extensionsTypesTypes.SendMessageHandler;

  type SendUserMessageHandler = extensionsTypesTypes.SendUserMessageHandler;

  type SessionBeforeCompactEvent = extensionsTypesTypes.SessionBeforeCompactEvent;

  type SessionBeforeCompactResult = extensionsTypesTypes.SessionBeforeCompactResult;

  type SessionBeforeForkEvent = extensionsTypesTypes.SessionBeforeForkEvent;

  type SessionBeforeForkResult = extensionsTypesTypes.SessionBeforeForkResult;

  type SessionBeforeSwitchEvent = extensionsTypesTypes.SessionBeforeSwitchEvent;

  type SessionBeforeSwitchResult = extensionsTypesTypes.SessionBeforeSwitchResult;

  type SessionBeforeTreeEvent = extensionsTypesTypes.SessionBeforeTreeEvent;

  type SessionBeforeTreeResult = extensionsTypesTypes.SessionBeforeTreeResult;

  type SessionBoundaryDraft = extensionsTypesTypes.SessionBoundaryDraft;

  type SessionCompactEvent = extensionsTypesTypes.SessionCompactEvent;

  type SessionCompactFailedEvent = extensionsTypesTypes.SessionCompactFailedEvent;

  type SessionEvent = extensionsTypesTypes.SessionEvent;

  type SessionInfoChangedEvent = extensionsTypesTypes.SessionInfoChangedEvent;

  type SessionShutdownEvent = extensionsTypesTypes.SessionShutdownEvent;

  type SessionStartEvent = extensionsTypesTypes.SessionStartEvent;

  type SessionTreeEvent = extensionsTypesTypes.SessionTreeEvent;

  type SetActiveToolsHandler = extensionsTypesTypes.SetActiveToolsHandler;

  type SetLabelHandler = extensionsTypesTypes.SetLabelHandler;

  type SetModelHandler = extensionsTypesTypes.SetModelHandler;

  type SetThinkingLevelHandler = extensionsTypesTypes.SetThinkingLevelHandler;

  type TerminalInputHandler = extensionsTypesTypes.TerminalInputHandler;

  type ThinkingLevelSelectEvent = extensionsTypesTypes.ThinkingLevelSelectEvent;

  type ToolAnnotations = extensionsTypesTypes.ToolAnnotations;

  type ToolCallEvent = extensionsTypesTypes.ToolCallEvent;

  type ToolCallEventResult = extensionsTypesTypes.ToolCallEventResult;

  type ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
    TState = any,
  > = extensionsTypesTypes.ToolDefinition<TParams, TDetails, TState>;

  type ToolExecutionEndEvent = extensionsTypesTypes.ToolExecutionEndEvent;

  type ToolExecutionMode = extensionsTypesTypes.ToolExecutionMode;

  type ToolExecutionStartEvent = extensionsTypesTypes.ToolExecutionStartEvent;

  type ToolExecutionUpdateEvent = extensionsTypesTypes.ToolExecutionUpdateEvent;

  type ToolExposure = extensionsTypesTypes.ToolExposure;

  type ToolInfo = extensionsTypesTypes.ToolInfo;

  type ToolLoadout = extensionsTypesTypes.ToolLoadout;

  type ToolLoadoutChanges = extensionsTypesTypes.ToolLoadoutChanges;

  type ToolNamespace = extensionsTypesTypes.ToolNamespace;

  type ToolRendererResolver = extensionsTypesTypes.ToolRendererResolver;

  type ToolRenderers = extensionsTypesTypes.ToolRenderers;

  type ToolRenderResultOptions = extensionsTypesTypes.ToolRenderResultOptions;

  type ToolResultEvent = extensionsTypesTypes.ToolResultEvent;

  type ToolResultEventResult = extensionsTypesTypes.ToolResultEventResult;

  type TreePreparation = extensionsTypesTypes.TreePreparation;

  type TurnEndEvent = extensionsTypesTypes.TurnEndEvent;

  type TurnEndEventResult = extensionsTypesTypes.TurnEndEventResult;

  type TurnStartEvent = extensionsTypesTypes.TurnStartEvent;

  type UIPromptEndEvent = extensionsTypesTypes.UIPromptEndEvent;

  type UIPromptKind = extensionsTypesTypes.UIPromptKind;

  type UIPromptStartEvent = extensionsTypesTypes.UIPromptStartEvent;

  type UserBashEvent = extensionsTypesTypes.UserBashEvent;

  type UserBashEventResult = extensionsTypesTypes.UserBashEventResult;

  type WidgetPlacement = extensionsTypesTypes.WidgetPlacement;

  type WorkingIndicatorOptions = extensionsTypesTypes.WorkingIndicatorOptions;

  type WriteToolCallEvent = extensionsTypesTypes.WriteToolCallEvent;

  type WriteToolResultEvent = extensionsTypesTypes.WriteToolResultEvent;
}

export type { extensionsTypes as default };
