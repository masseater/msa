import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  type AfterToolCallContext,
  type AfterToolCallResult,
  type Agent,
  type AgentContext,
  type AgentEvent,
  type AgentMessage,
  type AgentState,
  type AgentTool,
  type AgentToolCallOutcome,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
  type PrepareNextTurnContext,
  runToolCall,
  type ThinkingLevel,
} from "@msa/agent-core";
import { contentText, getCurrentSystemMessage, normalizeContext, retryDelayMs } from "@msa/ai";
import type {
  AssistantMessage,
  AuthResult,
  ImageContent,
  Model,
  ProviderHeaders,
  SystemMessage,
  TextContent,
  ToolResultMessage,
  Usage,
} from "@msa/ai/compat";
import {
  clampThinkingLevel,
  cleanupSessionResources,
  getSupportedThinkingLevels,
  isContextOverflow,
  isRecoverableLength,
  isRetryableAssistantError,
  modelsAreEqual,
  type RetryCallbacks,
  resetApiProviders,
  streamSimple,
} from "@msa/ai/compat";

import { getThemeByName, theme } from "../modes/interactive/theme/theme.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { stripFrontmatter } from "../utils/frontmatter.ts";
import { processImage } from "../utils/image-process.ts";
import { normalizeToolResultImages } from "../utils/tool-result-images.ts";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.ts";
import { type BashResult, executeBashWithOperations } from "./bash-executor.ts";
import { generateBugReportSummary } from "./bug-report.ts";
import type { CacheWarmer, CacheWarmingStatus } from "./cache-warmer.ts";
import {
  type CompactionPreparation,
  type CompactionResult,
  calculateContextTokens,
  collectEntriesForBranchSummary,
  compact,
  completeSummarization,
  estimateContextTokens,
  estimateProjectedContextTokens,
  estimateTokens,
  generateBranchSummary,
  prepareCompaction,
  shouldCompact,
} from "./compaction/index.ts";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "./defaults.ts";
import { exportSessionToHtml, type ToolHtmlRenderer } from "./export-html/index.ts";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.ts";
import {
  type AgentActivityOutcome,
  type BoundaryContextPreview,
  type ContextUsage,
  type ExecuteToolOptions,
  type ExtensionCommandContextActions,
  type ExtensionErrorListener,
  type ExtensionMode,
  ExtensionRunner,
  type ExtensionUIContext,
  type InputSource,
  type MessageEndEvent,
  type MessageStartEvent,
  type MessageUpdateEvent,
  type ReplacedSessionContext,
  type SessionBeforeCompactResult,
  type SessionBeforeTreeResult,
  type SessionBoundaryDraft,
  type SessionCompactFailedEvent,
  type SessionStartEvent,
  type ShutdownHandler,
  type ToolDefinition,
  type ToolExecutionEndEvent,
  type ToolExecutionStartEvent,
  type ToolExecutionUpdateEvent,
  type ToolExposure,
  type ToolInfo,
  type ToolLoadout,
  type TreePreparation,
  type TurnStartEvent,
  wrapRegisteredTools,
} from "./extensions/index.ts";
import { type BeforeAgentStartTrigger, emitSessionShutdownEvent } from "./extensions/runner.ts";
import { EXTERNAL_SERVICES, type ExternalService } from "./external-services.ts";
import {
  findActiveGoalCondition,
  GOAL_CONTINUE_MESSAGE_TYPE,
  GOAL_ENTRY_TYPE,
  GOAL_EVALUATOR_SYSTEM_PROMPT,
  type GoalCommand,
  type GoalEntryData,
  GoalLoop,
  type GoalSnapshot,
  parseGoalCommand,
  pickEvaluatorModel,
} from "./goal.ts";
import { createToolNameMatcher, isMcpToolName } from "./mcp-servers.ts";
import {
  formatMemoryList,
  formatRecallBlock,
  formatSearchResults,
  MEMORY_RECALL_MESSAGE_TYPE,
  type MemoryCommand,
  MemoryService,
  parseMemoryCommand,
} from "./memory/memory.ts";
import { type BashExecutionMessage, type CustomMessage, convertToLlm } from "./messages.ts";
import { ModelRegistry } from "./model-registry.ts";
import { resolveModelReference } from "./model-resolver.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { NestedToolCallRunner } from "./nested-tool-calls.ts";
import { Neo4jSessionGraph } from "./orchestrator/neo4j-graph.ts";
import {
  type CreateWorkerOptions,
  ORCHESTRATOR_REPORT_MESSAGE_TYPE,
  Orchestrator,
  type OrchestratorDefaults,
  type WorkerSession,
} from "./orchestrator/orchestrator.ts";
import { createOrchestratorToolDefinitions } from "./orchestrator/tools.ts";
import { expandPromptTemplate, type PromptTemplate } from "./prompt-templates.ts";
import type { ResourceExtensionPaths, ResourceLoader } from "./resource-loader.ts";
import { exportSessionToJsonl } from "./session-export.ts";
import {
  type BranchSummaryEntry,
  type CompactionEntry,
  type ContextEditEntry,
  getLatestCompactionEntry,
  type SessionEntry,
  SessionManager,
  type SessionProjection,
} from "./session-manager.ts";
import {
  applyToolModifiers,
  type CacheWarmingMode,
  DEFAULT_TOOL_NAMES,
  type SettingsManager,
} from "./settings-manager.ts";
import { type SlashCommandInfo, slashCommandName, withSkillCommands } from "./slash-commands.ts";
import {
  BUILTIN_PATH_PREFIX,
  createSyntheticSourceInfo,
  isSyntheticPath,
  type SourceInfo,
} from "./source-info.ts";
import {
  buildSystemPrompt,
  buildSystemPromptSections,
  diffSystemPromptSections,
  type NormalizedBuildSystemPromptOptions,
  normalizeBuildSystemPromptOptions,
} from "./system-prompt.ts";
import { type BashOperations, createLocalBashOperations } from "./tools/bash.ts";
import { createAllToolDefinitions } from "./tools/index.ts";
import { createMemoryToolDefinition } from "./tools/memory.ts";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.ts";
import { addUsageToTotals, combineUsage, createUsageTotals } from "./usage-totals.ts";
import {
  findLatestResponse,
  getBranchSelection,
  getVirtualModelState,
  isVirtualModel,
  VIRTUAL_MODEL_STATE_ENTRY,
  type VirtualModelStateData,
} from "./virtual-models.ts";

export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage: string | undefined;
}

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
  );
  if (match === null) return null;
  const [, name, location, content, userMessage] = match;
  if (name === undefined || location === undefined || content === undefined) return null;
  return {
    name,
    location,
    content,
    userMessage: userMessage?.trim() || undefined,
  };
}

type WithParentToolCallId<E> = E extends {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
}
  ? E & { parentToolCallId?: string }
  : E;

export type AgentSessionEvent =
  | WithParentToolCallId<Exclude<AgentEvent, { type: "agent_end" }>>
  | {
      type: "agent_end";
      messages: AgentMessage[];
      willRetry: boolean;
    }
  | { type: "agent_settled"; aborted: boolean }
  | {
      type: "queue_update";
      steering: readonly string[];
      followUp: readonly string[];
    }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | { type: "entry_appended"; entry: SessionEntry }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: ThinkingLevel }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      result: CompactionResult | undefined;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string | undefined;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string | undefined;
    }
  | {
      type: "summarization_retry_scheduled";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "summarization_retry_attempt_start"; source: "branchSummary" }
  | {
      type: "summarization_retry_attempt_start";
      source: "compaction";
      reason: "manual" | "threshold" | "overflow";
    }
  | { type: "summarization_retry_finished" }
  | { type: "bash_execution_update"; id?: string | undefined; delta: string }
  | { type: "goal_changed"; goal: GoalSnapshot | undefined }
  | { type: "orchestrator_changed" }
  | { type: "goal_status"; goal: GoalSnapshot | undefined }
  | { type: "memory_status"; text: string };

export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

function withoutDeletedHeaders(
  headers: ProviderHeaders | undefined,
): Record<string, string> | undefined {
  return headers === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
      );
}

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  cwd: string;
  scopedModels?:
    | Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel | undefined }>
    | undefined;
  resourceLoader: ResourceLoader;
  customTools?: ToolDefinition[] | undefined;
  modelRuntime: ModelRuntime;
  cacheWarmer?: Pick<
    CacheWarmer,
    "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed"
  >;
  initialActiveToolNames?: string[] | undefined;
  usesDefaultTools?: boolean | undefined;
  defaultToolModifiers?: string[] | undefined;
  allowedToolNames?: string[] | undefined;
  excludedToolNames?: string[] | undefined;
  baseToolsOverride?: Record<string, AgentTool> | undefined;
  extensionRunnerRef?: { current?: ExtensionRunner } | undefined;
  sessionStartEvent?: SessionStartEvent | undefined;
  createWorkerSession?: ((options: CreateWorkerOptions) => Promise<WorkerSession>) | undefined;
}

export interface ExtensionBindings {
  uiContext?: ExtensionUIContext;
  mode?: ExtensionMode;
  commandContextActions?: ExtensionCommandContextActions;
  abortHandler?: () => void;
  shutdownHandler?: ShutdownHandler;
  onError?: ExtensionErrorListener;
}

export type QueuedInputDisposition = "handled" | "queued";
export type PromptDisposition = QueuedInputDisposition | "started";

export interface PromptOptions {
  expandPromptTemplates?: boolean;
  images?: ImageContent[] | undefined;
  streamingBehavior?: "steer" | "followUp" | undefined;
  source?: InputSource;
  preflightResult?: (disposition: PromptDisposition) => void;
}

export interface ModelMutationOptions {
  persist?: boolean;
}

export interface ModelCycleResult {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
}

export interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage | undefined;
}

interface ToolDefinitionEntry {
  definition: ToolDefinition;
  sourceInfo: SourceInfo;
}

function estimateMessagesTokens(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateTokens(message);
  }
  return tokens;
}

export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;

  private scopedModelsInternal: Array<{
    model: Model<any>;
    thinkingLevel?: ThinkingLevel | undefined;
  }>;

  private unsubscribeAgent?: (() => void) | undefined;
  private eventListeners: AgentSessionEventListener[] = [];
  private isAgentRunActive = false;
  private agentRunAbortRequested = false;
  private idleWaitPromise: Promise<void> | undefined;
  private resolveIdleWait: (() => void) | undefined;

  private steeringMessages: string[] = [];
  private followUpMessages: string[] = [];
  private pendingNextTurnMessages: CustomMessage[] = [];
  private pendingCustomMessages: CustomMessage[] = [];

  private compactionAbortController: AbortController | undefined = undefined;
  private autoCompactionAbortController: AbortController | undefined = undefined;
  private overflowRecoveryAttempted = false;

  private branchSummaryAbortController: AbortController | undefined = undefined;

  private retryAbortController: AbortController | undefined = undefined;
  private retryAttemptInternal = 0;
  private failedResponse: AssistantMessage | undefined;

  private readonly bashAbortControllers = new Set<AbortController>();
  private pendingBashMessages: BashExecutionMessage[] = [];

  private extensionRunnerInternal!: ExtensionRunner;
  private turnIndex = 0;
  private readonly entryIdsByMessage = new WeakMap<object, string>();
  private readonly boundaryDispatchedMessages = new WeakSet<object>();
  private lastAssistantMessage: AssistantMessage | undefined;
  private lastAssistantToolResults: AgentMessage[] = [];
  private lastActivityOutcome: AgentActivityOutcome = "completed";
  private readonly goalInternal: GoalLoop;
  private readonly orchestratorInternal: Orchestrator | undefined;
  private totalTokensCache: { entryCount: number; total: number } | undefined;
  private isBeforeSettle = false;
  private abortDuringBeforeSettle = false;
  private isEmittingAgentSettled = false;
  private readonly deferredSettledActions: Array<() => Promise<void>> = [];

  private resourceLoaderInternal: ResourceLoader;
  private customTools: ToolDefinition[];
  private baseToolDefinitions: Map<string, ToolDefinition> = new Map();
  private cwd: string;
  private extensionRunnerRef?: { current?: ExtensionRunner } | undefined;
  private initialActiveToolNames?: string[] | undefined;
  private pendingToolNames = new Set<string>();
  private usesDefaultTools: boolean;
  private defaultToolModifiers: string[];
  private allowedTools?: (name: string) => boolean;
  private allowlistFiltersMcp = false;
  private excludedTools?: ((name: string) => boolean) | undefined;
  private baseToolsOverride?: Record<string, AgentTool> | undefined;
  private sessionStartEvent: SessionStartEvent;
  private extensionUIContext?: ExtensionUIContext;
  private extensionMode: ExtensionMode = "print";
  private extensionCommandContextActions?: ExtensionCommandContextActions;
  private extensionAbortHandler?: () => void;
  private extensionShutdownHandler?: ShutdownHandler;
  private extensionErrorListener?: ExtensionErrorListener;
  private extensionErrorUnsubscriber?: (() => void) | undefined;

  private modelRuntimeInternal: ModelRuntime;
  private memoryInternal: MemoryService | undefined;
  private cacheWarmer?:
    | Pick<CacheWarmer, "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed">
    | undefined;

  private toolRegistry: Map<string, AgentTool> = new Map();
  private nestedToolCalls: NestedToolCallRunner | undefined;
  private hiddenDeclarations: ReadonlySet<string> = new Set();
  private toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();
  private toolPromptSnippets: Map<string, string> = new Map();
  private toolPromptGuidelines: Map<string, string[]> = new Map();

  private baseSystemPromptOptions!: NormalizedBuildSystemPromptOptions;
  private runSystemPromptOptions?: NormalizedBuildSystemPromptOptions | undefined;

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
    this.scopedModelsInternal = config.scopedModels ?? [];
    this.resourceLoaderInternal = config.resourceLoader;
    this.customTools = config.customTools ?? [];
    this.cwd = config.cwd;
    this.modelRuntimeInternal = config.modelRuntime;
    this.cacheWarmer = config.cacheWarmer;
    if (this.cacheWarmer !== undefined) {
      this.cacheWarmer.onWarmed = (entry) => this.emit({ type: "entry_appended", entry });
    }
    this.extensionRunnerRef = config.extensionRunnerRef;
    this.initialActiveToolNames = config.initialActiveToolNames;
    this.usesDefaultTools = config.usesDefaultTools ?? false;
    this.defaultToolModifiers = config.defaultToolModifiers ?? [];
    if (config.allowedToolNames !== undefined) {
      this.allowedTools = createToolNameMatcher(config.allowedToolNames);
      this.allowlistFiltersMcp =
        config.allowedToolNames.length === 0 ||
        config.allowedToolNames.some((entry) => entry.startsWith("mcp__"));
    }
    this.excludedTools =
      config.excludedToolNames === undefined
        ? undefined
        : createToolNameMatcher(config.excludedToolNames);
    this.baseToolsOverride = config.baseToolsOverride;
    this.sessionStartEvent = config.sessionStartEvent ?? {
      type: "session_start",
      reason: "startup",
    };

    this.goalInternal = new GoalLoop(
      {
        messages: () => this.messages,
        totalTokens: () => this.totalSessionTokens(),
        lastAssistant: () => this.findLastAssistantMessage(),
        isContextOverflow: (message) =>
          isContextOverflow(
            message,
            (this.modelForMessage(message) ?? this.model)?.contextWindow ?? 0,
          ),
        evaluate: (prompt, signal) => this.evaluateGoal(prompt, signal),
        record: (data) => this.recordGoalEntry(data),
        queueContinue: (text) =>
          this.agent.followUp({
            role: "custom",
            customType: GOAL_CONTINUE_MESSAGE_TYPE,
            content: text,
            display: false,
            timestamp: Date.now(),
          }),
        changed: () => this.emit({ type: "goal_changed", goal: this.goalInternal.snapshot }),
      },
      findActiveGoalCondition(this.sessionManager.getBranch()),
    );

    const createWorkerSession = config.createWorkerSession;
    this.orchestratorInternal =
      createWorkerSession === undefined
        ? undefined
        : new Orchestrator({
            project: this.sessionManager.getSessionId(),
            cwd: this.cwd,
            connectGraph: () => Neo4jSessionGraph.connect(),
            createWorker: createWorkerSession,
            resolveModel: (reference) => this.resolveOrchestratorModel(reference),
            defaults: () => this.orchestratorDefaults(),
            report: (text, details) =>
              void this.sendCustomMessage(
                {
                  customType: ORCHESTRATOR_REPORT_MESSAGE_TYPE,
                  content: text,
                  display: true,
                  details,
                },
                { triggerTurn: true, deliverAs: "followUp" },
              ),
          });
    let orchestratorChangePending: ReturnType<typeof setTimeout> | undefined;
    this.orchestratorInternal?.onChange(() => {
      orchestratorChangePending ??= setTimeout(() => {
        orchestratorChangePending = undefined;
        this.emit({ type: "orchestrator_changed" });
      }, 100);
    });

    this.unsubscribeAgent = this.agent.subscribe(this.handleAgentEvent);
    this.installAgentToolHooks();
    this.installAgentNextTurnRefresh();
    this.installAgentRequestProjection();
    this.installAgentBoundaryHooks();
    this.installHiddenDeclarationsProjection();
    this.installAgentForcedPromptProjection();

    this.buildRuntime({
      activeToolNames: this.initialActiveToolNames,
      includeAllExtensionTools: true,
    });
    if (this.usesDefaultTools) this.restoreToolsFromTranscript(this.defaultToolModifiers);
  }

  get modelRuntime(): ModelRuntime {
    return this.modelRuntimeInternal;
  }

  private async getRequiredRequestAuth(
    model: Model<any>,
    signal?: AbortSignal,
  ): Promise<{
    model: Model<any>;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    env?: Record<string, string> | undefined;
  }> {
    let result: AuthResult | undefined;
    try {
      result = await this.modelRuntimeInternal.getAuth(
        model,
        signal === undefined ? {} : { signal },
      );
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      if (cause instanceof Error && cause.message === "authHeader requires a resolved API key") {
        throw new Error(formatNoApiKeyFoundMessage(model.provider), { cause: error });
      }
      throw error;
    }
    if (
      result !== undefined &&
      ((result.auth.apiKey ?? "") !== "" || result.auth.headers !== undefined)
    ) {
      const requestModel =
        result.auth.baseUrl !== undefined && result.auth.baseUrl !== ""
          ? { ...model, baseUrl: result.auth.baseUrl }
          : model;
      return {
        model: requestModel,
        apiKey: result.auth.apiKey,
        headers: withoutDeletedHeaders(result.auth.headers),
        env: result.env,
      };
    }

    const isOAuth = this.modelRuntimeInternal.isUsingOAuth(model.provider);
    if (isOAuth) {
      throw new Error(
        `Authentication failed for "${model.provider}". ` +
          `Credentials may have expired or network is unavailable. ` +
          `Run '/login ${model.provider}' to re-authenticate.`,
      );
    }
    throw new Error(formatNoApiKeyFoundMessage(model.provider));
  }

  private async getSummarizationRequestAuth(
    selectedModel: Model<any>,
    signal?: AbortSignal,
  ): Promise<{
    model: Model<any>;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    env?: Record<string, string> | undefined;
    thinkingLevel: ThinkingLevel;
  }> {
    const { model, thinkingLevel } = isVirtualModel(selectedModel)
      ? await this.modelRuntimeInternal.resolveModel(selectedModel, convertToLlm(this.messages), {
          reason: "direct",
          thinkingLevel: this.thinkingLevel,
          signal,
        })
      : { model: selectedModel, thinkingLevel: this.thinkingLevel };
    if (this.agent.streamFunction === streamSimple) {
      return { ...(await this.getRequiredRequestAuth(model, signal)), thinkingLevel };
    }

    try {
      const result = await this.modelRuntimeInternal.getAuth(
        model,
        signal === undefined ? {} : { signal },
      );
      if (result === undefined) return { model, thinkingLevel };
      const requestModel =
        result.auth.baseUrl !== undefined && result.auth.baseUrl !== ""
          ? { ...model, baseUrl: result.auth.baseUrl }
          : model;
      return {
        model: requestModel,
        apiKey: result.auth.apiKey,
        headers: withoutDeletedHeaders(result.auth.headers),
        env: result.env,
        thinkingLevel,
      };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return { model, thinkingLevel };
    }
  }

  private modelForMessage(message: AssistantMessage): Model<any> | undefined {
    const model = this.model;
    if (model !== undefined && isVirtualModel(model))
      return this.modelRuntimeInternal.getPhysicalModel(message.provider, message.model);
    return model?.provider === message.provider && model.id === message.model ? model : undefined;
  }

  private recordSelection(): void {
    const model = this.model;
    if (model === undefined) return;
    const getModel = (provider: string, modelId: string) =>
      this.modelRuntimeInternal.getModel(provider, modelId);
    const recorded = getBranchSelection(this.sessionManager.getBranch(), getModel);
    if (
      recorded === undefined ||
      (recorded.provider === model.provider && recorded.modelId === model.id)
    )
      return;
    const recordedModel = getModel(recorded.provider, recorded.modelId);
    if (!isVirtualModel(model) && (recordedModel && isVirtualModel(recordedModel)) !== true) return;
    this.sessionManager.appendModelChange(model.provider, model.id);
  }

  private limitsModel(): Model<any> | undefined {
    return this.routedModel?.model ?? this.model;
  }

  private installAgentToolHooks(): void {
    this.agent.beforeToolCall = (context) => this.beforeToolCall(context);
    this.agent.afterToolCall = (context) => this.afterToolCall(context);
  }

  private async beforeToolCall(
    { toolCall, args }: BeforeToolCallContext,
    parentToolCallId?: string,
  ): Promise<BeforeToolCallResult | undefined> {
    const runner = this.extensionRunnerInternal;
    if (!runner.hasHandlers("tool_call")) {
      return undefined;
    }

    try {
      return await runner.emitToolCall({
        type: "tool_call",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        ...(parentToolCallId !== undefined && parentToolCallId !== "" ? { parentToolCallId } : {}),
        input: args as Record<string, unknown>,
      });
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(`Extension failed, blocking execution: ${String(err)}`, { cause: err });
    }
  }

  private async afterToolCall(
    { toolCall, args, result, isError }: AfterToolCallContext,
    parentToolCallId?: string,
  ): Promise<AfterToolCallResult | undefined> {
    const runner = this.extensionRunnerInternal;
    const hookResult = runner.hasHandlers("tool_result")
      ? await runner.emitToolResult({
          type: "tool_result",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          ...(parentToolCallId !== undefined && parentToolCallId !== ""
            ? { parentToolCallId }
            : {}),
          input: args as Record<string, unknown>,
          content: result.content,
          details: result.details,
          ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: result.structuredContent }),
          isError,
          usage: result.usage,
        })
      : undefined;

    const content = hookResult?.content ?? result.content ?? [];
    const resizeOptions = this.limitsModel()?.inputLimits?.images?.resize;
    const normalizedContent = await normalizeToolResultImages(content, {
      autoResizeImages: this.settingsManager.getImageAutoResize(),
      ...(resizeOptions === undefined ? {} : { resizeOptions }),
    });

    if (hookResult === undefined && normalizedContent === content) {
      return undefined;
    }

    const details = hookResult?.details;
    const structuredContent =
      hookResult === undefined ? result.structuredContent : hookResult.structuredContent;
    const usage = hookResult?.usage;
    return {
      content: normalizedContent,
      ...(details === undefined ? {} : { details }),
      ...(structuredContent === undefined ? {} : { structuredContent }),
      isError: hookResult?.isError ?? isError,
      ...(usage === undefined ? {} : { usage }),
    };
  }

  private async executeNestedToolCall(
    parentToolCallId: string,
    name: string,
    args: unknown,
    options: ExecuteToolOptions,
  ): Promise<AgentToolCallOutcome> {
    this.nestedToolCalls ??= new NestedToolCallRunner({
      getTools: () => this.getCallableTools(),
      isSequential: () => this.agent.toolExecution === "sequential",
      runToolCall: (toolCall, parentId, signal, onUpdate) => {
        const assistantMessage = this.findLastAssistantMessage();
        if (assistantMessage === undefined) {
          return Promise.resolve({
            toolCall,
            result: {
              content: [{ type: "text", text: "No assistant message issued this call" }],
              details: {},
            },
            isError: true,
          });
        }
        return runToolCall(toolCall, {
          tools: this.getCallableTools(),
          assistantMessage,
          context: { messages: this.agent.state.messages, tools: this.agent.state.tools },
          beforeToolCall: (context) => this.beforeToolCall(context, parentId),
          afterToolCall: (context) => this.afterToolCall(context, parentId),
          ...(signal === undefined ? {} : { signal }),
          onUpdate,
        });
      },
      emit: async (event) => {
        await this.extensionRunnerInternal.emit(event);
        this.emit(event);
      },
    });
    return this.nestedToolCalls.execute(parentToolCallId, name, args, options);
  }

  private exceedsCompactionThreshold(model: Model<any>, projection: SessionProjection): boolean {
    if (model.contextWindow <= 0) return false;
    return shouldCompact(
      estimateProjectedContextTokens(projection, this.sessionManager.getBranch()).tokens,
      model.contextWindow,
      this.settingsManager.getCompactionSettings(this.model),
    );
  }

  private async compactBeforeNextAssistantResponse(context: AgentContext): Promise<AgentContext> {
    const projection = this.sessionManager.buildSessionProjection();
    const model = this.model;
    if (
      model === undefined ||
      isVirtualModel(model) ||
      !this.exceedsCompactionThreshold(model, projection)
    ) {
      return { ...context, messages: projection.messages };
    }
    await this.runAutoCompaction("threshold", false);
    return { ...context, messages: this.sessionManager.buildSessionProjection().messages };
  }

  private installAgentRequestProjection(): void {
    const previousPrepareRequest = this.agent.prepareRequest;
    this.agent.prepareRequest = async (request, signal) => {
      const failed = this.failedResponse;
      this.failedResponse = undefined;
      const prepare = async () => {
        const projection = this.sessionManager.buildSessionProjection();
        const canonicalContext = {
          ...request.context,
          messages: projection.messages,
          tools: this.agent.state.tools.slice(),
        };
        const previous = await previousPrepareRequest?.(
          {
            ...request,
            context: canonicalContext,
            model: this.agent.state.model,
            thinkingLevel: this.agent.state.thinkingLevel,
          },
          signal,
        );
        return { previous, context: previous?.context ?? canonicalContext, projection };
      };
      let { previous, context, projection } = await prepare();
      const model = previous?.model ?? this.agent.state.model;
      const thinkingLevel = previous?.thinkingLevel ?? this.agent.state.thinkingLevel;
      if (!isVirtualModel(model)) return { ...previous, context, model, thinkingLevel };

      const lastResponse = context.messages.findLastIndex(
        (message) => message.role === "assistant",
      );
      const userTurn = context.messages
        .slice(lastResponse + 1)
        .some((message) => message.role === "user");
      const state = getVirtualModelState(this.sessionManager.getBranch(), model.provider, model.id);
      const route = await this.modelRuntimeInternal.resolveModel(
        model,
        convertToLlm(context.messages),
        {
          reason: failed === undefined ? (userTurn ? "user" : "continuation") : "retry",
          thinkingLevel,
          signal,
          failed,
          state,
        },
      );
      if (route.state !== undefined && route.state !== state) {
        const data: VirtualModelStateData = {
          provider: model.provider,
          modelId: model.id,
          state: route.state,
        };
        const entry = this.sessionManager.getEntry(
          this.sessionManager.appendCustomEntry(VIRTUAL_MODEL_STATE_ENTRY, data),
        );
        if (entry !== undefined) this.emit({ type: "entry_appended", entry });
      }
      if (this.exceedsCompactionThreshold(route.model, projection)) {
        await this.runAutoCompaction("threshold", false);
        ({ previous, context } = await prepare());
      }
      return { ...previous, context, model: route.model, thinkingLevel: route.thinkingLevel };
    };
  }

  private async dispatchTurnEndBoundary(
    message: AssistantMessage,
    toolResults: ToolResultMessage[],
  ): Promise<boolean> {
    this.lastActivityOutcome =
      message.stopReason === "aborted"
        ? "aborted"
        : message.stopReason === "error"
          ? "error"
          : "completed";
    const messageEntryId = this.findPersistedMessageEntryId(message);
    if (!this.extensionRunnerInternal.hasHandlers("turn_end")) return false;
    if (messageEntryId === undefined || messageEntryId === "") {
      this.extensionRunnerInternal.emitError({
        extensionPath: "<boundary>",
        event: "turn_end",
        error: "turn_end could not resolve the persisted assistant entry ID",
      });
      return false;
    }
    const toolResultEntryIds = toolResults.flatMap((result) => {
      const entryId = this.findPersistedMessageEntryId(result);
      return entryId !== undefined && entryId !== "" ? [entryId] : [];
    });
    const boundary = await this.extensionRunnerInternal.emitBoundary(
      {
        type: "turn_end",
        turnIndex: this.turnIndex,
        message,
        toolResults,
        messageEntryId,
        toolResultEntryIds,
        outcome: this.lastActivityOutcome,
      },
      (entries) => this.buildBoundaryContext(entries, "turn_end"),
    );
    this.commitBoundaryDrafts(boundary.entries);
    if (boundary.continue && !this.buildBoundaryContext([], "turn_end").canContinue) {
      this.reportInvalidBoundaryContinuation("turn_end");
      return false;
    }
    return boundary.continue;
  }

  private installAgentBoundaryHooks(): void {
    const previousFinishTurn = this.agent.finishTurn;
    this.agent.finishTurn = async (turn, signal) => {
      this.boundaryDispatchedMessages.add(turn.message);
      const extensionContinue = await this.dispatchTurnEndBoundary(turn.message, turn.toolResults);
      const previousDecision = await previousFinishTurn?.(turn, signal);
      if (previousDecision?.action === "end") return previousDecision;
      if (extensionContinue || previousDecision?.action === "continue")
        return { action: "continue" };
      return undefined;
    };
  }

  private installAgentNextTurnRefresh(): void {
    const previousPrepareNextTurnWithContext =
      this.agent.prepareNextTurnWithContext ??
      (this.agent.prepareNextTurn === undefined
        ? undefined
        : async (_turn: PrepareNextTurnContext, signal?: AbortSignal) =>
            await this.agent.prepareNextTurn?.(signal));
    this.agent.prepareNextTurnWithContext = async (turn, signal) => {
      const context = await this.compactBeforeNextAssistantResponse(turn.context);
      const previousSnapshot = await previousPrepareNextTurnWithContext?.(
        { ...turn, context },
        signal,
      );
      const nextContext = previousSnapshot?.context ?? context;
      const runOptions = this.runSystemPromptOptions ?? this.baseSystemPromptOptions;
      const options = normalizeBuildSystemPromptOptions({
        ...runOptions,
        selectedTools: this.getActiveToolNames(),
        toolSnippets: { ...this.baseSystemPromptOptions.toolSnippets, ...runOptions.toolSnippets },
        toolGuidelines: {
          ...this.baseSystemPromptOptions.toolGuidelines,
          ...runOptions.toolGuidelines,
        },
      });
      const updateMessage = this.preparePromptAndToolLoadout(options, nextContext.messages);
      this.runSystemPromptOptions = options;

      return {
        ...previousSnapshot,
        context: {
          ...nextContext,
          tools: this.agent.state.tools.slice(),
        },
        ...(updateMessage === undefined
          ? {}
          : { messages: [...(previousSnapshot?.messages ?? []), updateMessage] }),
        model: this.agent.state.model,
        thinkingLevel: this.agent.state.thinkingLevel,
      };
    };
  }

  private refreshFinalizedContext(): void {
    const projection = this.sessionManager.buildSessionProjection();
    for (const entry of projection.entries) {
      for (const message of entry.messages)
        this.entryIdsByMessage.set(message, entry.sourceEntry.id);
    }
    this.agent.state.messages = projection.messages;
  }

  private applyBoundaryDrafts(
    manager: SessionManager,
    drafts: SessionBoundaryDraft[],
  ): SessionEntry[] {
    const appended: SessionEntry[] = [];
    for (const draft of drafts) {
      let entryId: string;
      switch (draft.type) {
        case "custom":
          entryId = manager.appendCustomEntry(draft.customType, draft.data);
          break;
        case "custom_message":
          entryId = manager.appendCustomMessageEntry(
            draft.customType,
            draft.content,
            draft.display,
            draft.details,
          );
          break;
        case "context_edit":
          entryId = manager.appendContextEdit(draft.targetId, draft.replacement);
          break;
        case "compaction": {
          const tokensBefore = estimateProjectedContextTokens(
            manager.buildSessionProjection(),
            manager.getBranch(),
          ).tokens;
          entryId = manager.appendCompaction(
            draft.summary,
            draft.firstKeptEntryId,
            tokensBefore,
            draft.details,
            true,
            draft.usage,
          );
          break;
        }
      }
      const entry = manager.getEntry(entryId);
      if (entry !== undefined) appended.push(entry);
    }
    return appended;
  }

  private createBoundaryPreviewManager(drafts: SessionBoundaryDraft[]): SessionManager {
    const header = this.sessionManager.getHeader();
    if (header === null) throw new Error("Session header is missing");
    const manager = SessionManager.inMemory(this.cwd, undefined, [
      header,
      ...this.sessionManager.getBranch(),
    ]);
    this.applyBoundaryDrafts(manager, drafts);
    return manager;
  }

  private getPendingBoundaryMessages(): AgentMessage[] {
    return [...this.agent.peekQueuedMessages(), ...this.pendingCustomMessages];
  }

  private buildBoundaryContext(
    drafts: SessionBoundaryDraft[],
    boundary: "turn_end" | "agent_before_settle",
  ): BoundaryContextPreview {
    const projection = this.createBoundaryPreviewManager(drafts).buildSessionProjection();
    const pendingMessages = this.getPendingBoundaryMessages();
    const llmMessages = convertToLlm(projection.messages);
    const finalRole = llmMessages[llmMessages.length - 1]?.role;
    const hasNonSystemContext = llmMessages.some((message) => message.role !== "system");
    const contextCanContinue = hasNonSystemContext && finalRole !== "assistant";
    const pendingCustomContext = this.pendingCustomMessages.length > 0;
    return {
      contextEntries: projection.entries,
      contextMessages: projection.messages,
      llmMessages,
      pendingMessages,
      canContinue:
        contextCanContinue ||
        pendingCustomContext ||
        (boundary === "turn_end"
          ? this.agent.hasQueuedMessages()
          : finalRole === "assistant" && this.agent.hasQueuedMessages()),
    };
  }

  private commitBoundaryDrafts(drafts: SessionBoundaryDraft[]): void {
    const appended = this.applyBoundaryDrafts(this.sessionManager, drafts);
    this.refreshFinalizedContext();
    for (const entry of appended) this.emit({ type: "entry_appended", entry });
  }

  private reportInvalidBoundaryContinuation(event: "turn_end" | "agent_before_settle"): void {
    this.extensionRunnerInternal.emitError({
      extensionPath: "<boundary>",
      event,
      error: `${event} requested continuation without runnable model context`,
    });
  }

  private emit(event: AgentSessionEvent): void {
    for (const l of this.eventListeners) {
      l(event);
    }
  }

  private emitQueueUpdate(): void {
    this.emit({
      type: "queue_update",
      steering: [...this.steeringMessages],
      followUp: [...this.followUpMessages],
    });
  }

  private async emitSessionCompactFailed(
    event: Omit<SessionCompactFailedEvent, "type">,
  ): Promise<void> {
    if (this.extensionRunnerInternal.hasHandlers("session_compact_failed")) {
      await this.extensionRunnerInternal.emit({ type: "session_compact_failed", ...event });
    }
  }

  private getIdleWaitPromise(): Promise<void> {
    if (this.idleWaitPromise === undefined) {
      this.idleWaitPromise = new Promise((resolve) => {
        this.resolveIdleWait = resolve;
      });
    }
    return this.idleWaitPromise;
  }

  private resolveIdleWaitIfIdle(): void {
    if (!this.isIdle || this.resolveIdleWait === undefined) {
      return;
    }
    const resolve = this.resolveIdleWait;
    this.idleWaitPromise = undefined;
    this.resolveIdleWait = undefined;
    resolve();
  }

  private async emitAgentSettled(): Promise<void> {
    this.cacheWarmer?.onAgentSettled();
    this.isAgentRunActive = false;
    this.isEmittingAgentSettled = true;
    try {
      const aborted = this.agentRunAbortRequested;
      await this.extensionRunnerInternal.emit({ type: "agent_settled", aborted });
      this.emit({ type: "agent_settled", aborted });
    } finally {
      this.isEmittingAgentSettled = false;
    }

    const deferred = this.deferredSettledActions.splice(0);
    if (deferred.length > 0) {
      try {
        for (const action of deferred) await action();
      } finally {
        this.resolveIdleWaitIfIdle();
      }
      return;
    }
    this.resolveIdleWaitIfIdle();
  }

  private handleAgentEvent = async (event: AgentEvent): Promise<void> => {
    if (event.type === "agent_start" && this.agentRunAbortRequested) this.agent.abort();
    if (this.nestedToolCalls !== undefined) {
      if (event.type === "message_start" && event.message.role === "toolResult") {
        const message = event.message;
        const summary = this.nestedToolCalls.takeRecord(message.toolCallId);
        if (summary?.calls !== undefined) message.nestedCalls = summary.calls;
        if (summary?.usage !== undefined) {
          message.usage =
            message.usage === undefined
              ? summary.usage
              : combineUsage(message.usage, summary.usage);
        }
      } else if (event.type === "agent_end") {
        this.nestedToolCalls.clear();
      }
    }
    if (event.type === "tool_execution_start") this.goalInternal.noteToolUse();
    if (event.type === "message_start" && event.message.role === "user") {
      this.overflowRecoveryAttempted = false;
      const messageText = contentText(event.message.content, "");
      if (messageText !== "") {
        const steeringIndex = this.steeringMessages.indexOf(messageText);
        if (steeringIndex === -1) {
          const followUpIndex = this.followUpMessages.indexOf(messageText);
          if (followUpIndex !== -1) {
            this.followUpMessages.splice(followUpIndex, 1);
            this.emitQueueUpdate();
          }
        } else {
          this.steeringMessages.splice(steeringIndex, 1);
          this.emitQueueUpdate();
        }
      }
    }

    await this.emitExtensionEvent(event);
    this.emit(
      event.type === "agent_end"
        ? { ...event, willRetry: this.willRetryAfterAgentEnd(event) }
        : event,
    );

    if (event.type === "message_end") {
      let entryId: string | undefined;
      if (event.message.role === "custom") {
        entryId = this.sessionManager.appendCustomMessageEntry(
          event.message.customType,
          event.message.content,
          event.message.display,
          event.message.details,
        );
      } else if (
        event.message.role === "system" ||
        event.message.role === "user" ||
        event.message.role === "assistant" ||
        event.message.role === "toolResult"
      ) {
        entryId = this.sessionManager.appendMessage(event.message);
      }
      if (entryId !== undefined && entryId !== "")
        this.entryIdsByMessage.set(event.message, entryId);

      if (event.message.role === "assistant") {
        const assistantMsg = event.message as AssistantMessage;
        this.lastAssistantMessage = assistantMsg;
        if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length") {
          this.overflowRecoveryAttempted = false;
        }

        if (assistantMsg.stopReason !== "error" && this.retryAttemptInternal > 0) {
          this.emit({
            type: "auto_retry_end",
            success: true,
            attempt: this.retryAttemptInternal,
          });
          this.retryAttemptInternal = 0;
        }
      }
    }

    if (event.type === "turn_end") {
      this.lastAssistantToolResults = event.toolResults;
      this.flushPendingCustomMessages();
    }
  };

  private willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
    if (this.agentRunAbortRequested) return false;
    const settings = this.settingsManager.getRetrySettings();
    if (!settings.enabled || this.retryAttemptInternal >= settings.maxRetries) {
      return false;
    }

    for (let i = event.messages.length - 1; i >= 0; i--) {
      const message = event.messages[i];
      if (message?.role === "assistant") {
        return this.isRetryableError(message as AssistantMessage);
      }
    }
    return false;
  }

  private findPersistedMessageEntryId(message: AgentMessage): string | undefined {
    const mapped = this.entryIdsByMessage.get(message);
    if (mapped !== undefined && mapped !== "") return mapped;
    for (const entry of [...this.sessionManager.getBranch()].reverse()) {
      if (entry.type === "message" && entry.message === message) return entry.id;
    }

    const messageIndex = this.agent.state.messages.indexOf(message);
    if (messageIndex < 0) return undefined;
    const projection = this.sessionManager.buildSessionProjection();
    let projectedIndex = 0;
    for (const entry of projection.entries) {
      for (let i = 0; i < entry.messages.length; i++) {
        if (projectedIndex === messageIndex) {
          this.entryIdsByMessage.set(message, entry.sourceEntry.id);
          return entry.sourceEntry.id;
        }
        projectedIndex++;
      }
    }
    return undefined;
  }

  private omitRecoveryAttempt(message: AssistantMessage, toolResults: AgentMessage[] = []): void {
    const targets = [message, ...toolResults];
    const targetIds = targets.map((target) => this.findPersistedMessageEntryId(target));
    const unresolvedProjectedTarget = targets.some(
      (target, index) =>
        targetIds[index] === undefined && this.agent.state.messages.includes(target),
    );
    if (unresolvedProjectedTarget) {
      throw new Error(
        "Cannot persist recovery omission because a projected message has no source entry",
      );
    }
    for (const targetId of targetIds) {
      if (targetId === undefined || targetId === "") continue;
      const editId = this.sessionManager.appendContextEdit(targetId, null);
      const entry = this.sessionManager.getEntry(editId);
      if (entry !== undefined) this.emit({ type: "entry_appended", entry });
    }
    this.refreshFinalizedContext();
  }

  private findLastAssistantMessage(): AssistantMessage | undefined {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "assistant") {
        return msg as AssistantMessage;
      }
    }
    return undefined;
  }

  private replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
    if (target === replacement) {
      return;
    }

    const targetRecord = target as unknown as Record<string, unknown>;
    for (const key of Object.keys(targetRecord)) {
      delete targetRecord[key];
    }
    Object.assign(targetRecord, replacement);
  }

  private async emitExtensionEvent(event: AgentEvent): Promise<void> {
    if (event.type === "agent_start") {
      this.turnIndex = 0;
      await this.extensionRunnerInternal.emit({ type: "agent_start" });
    } else if (event.type === "agent_end") {
      await this.extensionRunnerInternal.emit({ type: "agent_end", messages: event.messages });
    } else if (event.type === "turn_start") {
      const extensionEvent: TurnStartEvent = {
        type: "turn_start",
        turnIndex: this.turnIndex,
        timestamp: Date.now(),
      };
      await this.extensionRunnerInternal.emit(extensionEvent);
    } else if (event.type === "turn_end") {
      if (
        event.message.role === "assistant" &&
        !this.boundaryDispatchedMessages.delete(event.message)
      ) {
        await this.dispatchTurnEndBoundary(event.message, event.toolResults);
      }
      this.turnIndex++;
    } else if (event.type === "message_start") {
      const extensionEvent: MessageStartEvent = {
        type: "message_start",
        message: event.message,
      };
      await this.extensionRunnerInternal.emit(extensionEvent);
    } else if (event.type === "message_update") {
      const extensionEvent: MessageUpdateEvent = {
        type: "message_update",
        message: event.message,
        assistantMessageEvent: event.assistantMessageEvent,
      };
      await this.extensionRunnerInternal.emit(extensionEvent);
    } else if (event.type === "message_end") {
      const extensionEvent: MessageEndEvent = {
        type: "message_end",
        message: event.message,
      };
      const replacement = await this.extensionRunnerInternal.emitMessageEnd(extensionEvent);
      if (replacement !== undefined) {
        const normalized =
          (replacement.role === "user" ||
            replacement.role === "assistant" ||
            replacement.role === "toolResult" ||
            replacement.role === "custom") &&
          replacement.content == null
            ? ({ ...replacement, content: [] } as AgentMessage)
            : replacement;
        this.replaceMessageInPlace(event.message, normalized);
      }
    } else if (event.type === "tool_execution_start") {
      const extensionEvent: ToolExecutionStartEvent = {
        type: "tool_execution_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
      await this.extensionRunnerInternal.emit(extensionEvent);
    } else if (event.type === "tool_execution_update") {
      const extensionEvent: ToolExecutionUpdateEvent = {
        type: "tool_execution_update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult,
      };
      await this.extensionRunnerInternal.emit(extensionEvent);
    } else if (event.type === "tool_execution_end") {
      const extensionEvent: ToolExecutionEndEvent = {
        type: "tool_execution_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      };
      await this.extensionRunnerInternal.emit(extensionEvent);
    }
  }

  subscribe(listener: AgentSessionEventListener): () => void {
    this.eventListeners.push(listener);

    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  private disconnectFromAgent(): void {
    if (this.unsubscribeAgent !== undefined) {
      this.unsubscribeAgent();
      this.unsubscribeAgent = undefined;
    }
  }

  dispose(): void {
    try {
      this.abortRetry();
      this.abortCompaction();
      this.abortBranchSummary();
      this.abortBash();
      this.goalInternal.abort();
      this.agent.abort();
    } catch {}
    void this.orchestratorInternal?.dispose().catch(() => undefined);
    this.memoryInternal?.close();
    this.memoryInternal = undefined;

    this.extensionRunnerInternal.invalidate(
      "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
    );
    this.disconnectFromAgent();
    this.eventListeners = [];
    if (this.cacheWarmer !== undefined) {
      this.cacheWarmer.onWarmed = undefined;
      this.cacheWarmer.cancel();
    }
    cleanupSessionResources(this.sessionId);
  }

  refreshContext(): void {
    this.refreshFinalizedContext();
  }

  get state(): AgentState {
    return this.agent.state;
  }

  get cacheWarmingStatus(): CacheWarmingStatus | undefined {
    return this.cacheWarmer?.status;
  }

  setCacheWarmingMode(mode: CacheWarmingMode): void {
    this.settingsManager.setCacheWarmingMode(mode);
    this.cacheWarmer?.onModeChanged();
  }

  get model(): Model<any> | undefined {
    return this.agent.state.model;
  }

  get thinkingLevel(): ThinkingLevel {
    return this.agent.state.thinkingLevel;
  }

  get routedModel(): { model: Model<any>; thinkingLevel?: ThinkingLevel | undefined } | undefined {
    if (this.model === undefined || !isVirtualModel(this.model)) return undefined;
    const latest = findLatestResponse(this.agent.state.messages);
    const model =
      latest && this.modelRuntimeInternal.getPhysicalModel(latest.provider, latest.model);
    return model && { model, thinkingLevel: latest?.thinkingLevel };
  }

  get isStreaming(): boolean {
    return this.isAgentRunActive;
  }

  get isIdle(): boolean {
    return !this.isAgentRunActive && !this.isCompacting;
  }

  get systemPrompt(): string {
    return buildSystemPrompt(this.runSystemPromptOptions ?? this.baseSystemPromptOptions);
  }

  get retryAttempt(): number {
    return this.retryAttemptInternal;
  }

  getActiveToolNames(): string[] {
    return this.agent.state.tools.map((t) => t.name);
  }

  getCallableToolNames(): string[] {
    return this.getCallableTools().map((t) => t.name);
  }

  getAllTools(): ToolInfo[] {
    return Array.from(this.toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      promptGuidelines: definition.promptGuidelines,
      exposure: this.getToolExposure(definition.name),
      ...(definition.namespace === undefined ? {} : { namespace: definition.namespace }),
      ...(definition.annotations === undefined
        ? {}
        : { annotations: { ...definition.annotations } }),
      ...(definition.reachesTools === undefined ? {} : { reachesTools: definition.reachesTools }),
      sourceInfo,
    }));
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.toolDefinitions.get(name)?.definition;
  }

  setActiveToolsByName(toolNames: string[]): void {
    const previous = this.getActiveToolNames();
    this.setActiveTools(toolNames);
    const active = new Set(this.getActiveToolNames());
    if (previous.some((name) => !active.has(name))) this.pendingToolNames.clear();
  }

  private setActiveTools(toolNames: string[]): void {
    const tools = this.applyToolLoadout(toolNames);
    for (const tool of tools) this.pendingToolNames.delete(tool.name);
    this.rebuildSystemPrompt(tools.map((tool) => tool.name));
  }

  private isAllowedTool(name: string): boolean {
    if (this.excludedTools?.(name) === true) return false;
    if (this.allowedTools === undefined || this.allowedTools(name)) return true;
    return !this.allowlistFiltersMcp && isMcpToolName(name);
  }

  private isActivatable(name: string): boolean {
    if (this.allowedTools === undefined || this.allowedTools(name) || !isMcpToolName(name))
      return true;
    return this.getToolExposure(name) !== "direct" && this.toolRegistry.has("tool_search");
  }

  private getToolExposure(name: string): ToolExposure {
    return this.toolDefinitions.get(name)?.definition.exposure ?? "direct";
  }

  private getCallableTools(
    active: ReadonlySet<string> = new Set(this.getActiveToolNames()),
  ): AgentTool[] {
    return [...this.toolRegistry.values()].filter((tool) => {
      const exposure = this.getToolExposure(tool.name);
      return (
        exposure === "codemode" ||
        exposure === "deferred" ||
        (exposure === "direct" && active.has(tool.name))
      );
    });
  }

  private applyToolLoadout(toolNames: string[]): AgentTool[] {
    const tools = [...new Set(toolNames)].flatMap((name) => {
      const tool = this.toolRegistry.get(name);
      return tool !== undefined &&
        this.getToolExposure(name) !== "hidden" &&
        this.isActivatable(name)
        ? [tool]
        : [];
    });
    const hooks = tools.flatMap((tool) => {
      const entry = this.toolDefinitions.get(tool.name);
      return entry?.definition.prepareLoadout === undefined ? [] : [entry];
    });
    const hidden = new Set<string>();
    let declared = tools;
    if (hooks.length > 0) {
      const loadout: ToolLoadout = {
        declared: tools,
        callable: this.getCallableTools(new Set(tools.map((tool) => tool.name))),
        registered: [...this.toolRegistry.values()],
        getExposure: (name) => this.getToolExposure(name),
        getNamespace: (name) => this.toolDefinitions.get(name)?.definition.namespace,
        getPromptGuidelines: (name) => this.toolPromptGuidelines.get(name) ?? [],
      };
      const descriptions = new Map<string, string>();
      for (const { definition, sourceInfo } of hooks) {
        try {
          const changes = definition.prepareLoadout?.(loadout);
          for (const [name, description] of Object.entries(changes?.descriptions ?? {})) {
            descriptions.set(name, description);
          }
          for (const name of changes?.hiddenDeclarations ?? []) hidden.add(name);
        } catch (error) {
          this.extensionRunnerInternal.emitError({
            extensionPath: sourceInfo.path,
            event: "prepare_loadout",
            error: toErrorMessage(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
      declared = tools.map((tool) => {
        const description = descriptions.get(tool.name);
        return description === undefined ? tool : { ...tool, description };
      });
    }
    this.hiddenDeclarations = hidden;
    this.agent.state.tools = declared;
    return declared;
  }

  get isCompacting(): boolean {
    return (
      this.autoCompactionAbortController !== undefined ||
      this.compactionAbortController !== undefined ||
      this.branchSummaryAbortController !== undefined
    );
  }

  get messages(): AgentMessage[] {
    return this.agent.state.messages;
  }

  get steeringMode(): "all" | "one-at-a-time" {
    return this.agent.steeringMode;
  }

  get followUpMode(): "all" | "one-at-a-time" {
    return this.agent.followUpMode;
  }

  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }

  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }

  get sessionName(): string | undefined {
    return this.sessionManager.getSessionName();
  }

  get scopedModels(): ReadonlyArray<{
    model: Model<any>;
    thinkingLevel?: ThinkingLevel | undefined;
  }> {
    return this.scopedModelsInternal;
  }

  setScopedModels(
    scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel | undefined }>,
  ): void {
    this.scopedModelsInternal = scopedModels;
  }

  get promptTemplates(): ReadonlyArray<PromptTemplate> {
    return this.resourceLoaderInternal.getPrompts().prompts;
  }

  private normalizePromptSnippet(text: string | undefined): string | undefined {
    if (text === undefined || text === "") return undefined;
    const oneLine = text
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return oneLine.length > 0 ? oneLine : undefined;
  }

  private normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
    if (guidelines === undefined || guidelines.length === 0) {
      return [];
    }

    const unique = new Set<string>();
    for (const guideline of guidelines) {
      const normalized = guideline.trim();
      if (normalized.length > 0) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  }

  private rebuildSystemPrompt(toolNames: string[]): void {
    const validToolNames = toolNames.filter((name) => this.toolRegistry.has(name));
    const toolSnippets: Record<string, string> = {};
    for (const name of this.toolRegistry.keys()) {
      const snippet = this.toolPromptSnippets.get(name);
      if (snippet !== undefined && snippet !== "") toolSnippets[name] = snippet;
    }

    const loaderSystemPrompt = this.resourceLoaderInternal.getSystemPrompt();
    const loaderAppendSystemPrompt = this.resourceLoaderInternal.getAppendSystemPrompt();
    const appendSystemPrompt =
      loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : "";
    const loadedSkills = this.resourceLoaderInternal.getSkills().skills;
    const loadedContextFiles = this.resourceLoaderInternal.getAgentsFiles().agentsFiles;

    this.baseSystemPromptOptions = normalizeBuildSystemPromptOptions({
      cwd: this.cwd,
      skills: loadedSkills,
      contextFiles: loadedContextFiles,
      customPrompt: loaderSystemPrompt,
      appendSystemPrompt,
      selectedTools: validToolNames,
      hiddenTools: [...this.hiddenDeclarations],
      toolSnippets,
      toolGuidelines: Object.fromEntries(this.toolPromptGuidelines),
    });
  }

  private preparePromptAndToolLoadout(
    options: NormalizedBuildSystemPromptOptions,
    messages: AgentMessage[] = this.agent.state.messages,
  ): SystemMessage | undefined {
    options.selectedTools = this.applyToolLoadout(options.selectedTools).map((tool) => tool.name);
    options.hiddenTools = [...this.hiddenDeclarations];
    const sections = diffSystemPromptSections(
      getCurrentSystemMessage(messages)?.sections ?? {},
      buildSystemPromptSections(options),
    );
    return sections === undefined
      ? undefined
      : { role: "system", content: "", sections, timestamp: Date.now() };
  }

  private installHiddenDeclarationsProjection(): void {
    const previousTransformContext = this.agent.transformContext;
    this.agent.transformContext = async (messages, signal) => {
      const transformed =
        previousTransformContext === undefined
          ? messages
          : await previousTransformContext(messages, signal);
      const hidden = this.hiddenDeclarations;
      if (hidden.size === 0) return transformed;
      return transformed.map((message) => {
        if (
          message.role !== "system" ||
          (message.toolsAdded === undefined && message.toolsRemoved === undefined)
        )
          return message;
        const { toolsAdded, toolsRemoved, ...rest } = message;
        const added = toolsAdded?.filter((tool) => !hidden.has(tool.name)) ?? [];
        const removed = toolsRemoved?.filter((tool) => !hidden.has(tool.name)) ?? [];
        return {
          ...rest,
          ...(added.length > 0 ? { toolsAdded: added } : {}),
          ...(removed.length > 0 ? { toolsRemoved: removed } : {}),
        };
      });
    };
  }

  private installAgentForcedPromptProjection(): void {
    const previousTransformContext = this.agent.transformContext;
    this.agent.transformContext = async (messages, signal) => {
      const transformed =
        previousTransformContext === undefined
          ? messages
          : await previousTransformContext(messages, signal);
      const forced = this.runSystemPromptOptions?.forceSystemPrompt;
      if (forced === undefined) return transformed;
      const current = getCurrentSystemMessage(transformed);
      const head: SystemMessage = {
        role: "system",
        content: forced,
        ...(current?.toolsAdded === undefined ? {} : { toolsAdded: current.toolsAdded }),
        timestamp: current?.timestamp ?? Date.now(),
      };
      return [head, ...transformed.filter((message) => message.role !== "system")];
    };
  }

  private restoreToolsFromTranscript(modifiers: readonly string[] = []): void {
    this.pendingToolNames.clear();
    const current = getCurrentSystemMessage(this.sessionManager.buildSessionContext().messages);
    if (current === undefined) return;
    const names = applyToolModifiers(
      (current.toolsAdded ?? []).map((tool) => tool.name),
      modifiers,
    );
    this.pendingToolNames = new Set(names.filter((name) => this.isAllowedTool(name)));
    this.setActiveTools(names);
  }

  private async startRun(trigger: BeforeAgentStartTrigger, onStarted?: () => void): Promise<void> {
    this.isAgentRunActive = true;
    this.agentRunAbortRequested = false;
    let messages: AgentMessage[];
    try {
      messages = await this.prepareRun(trigger);
    } catch (error) {
      this.isAgentRunActive = false;
      this.flushPendingBashMessages();
      this.flushPendingCustomMessages();
      this.resolveIdleWaitIfIdle();
      throw error;
    }
    this.flushPendingBashMessages();
    this.flushPendingCustomMessages();
    onStarted?.();

    this.failedResponse = undefined;
    this.recordSelection();
    this.pendingToolNames.clear();
    this.goalInternal.resetGuards();
    try {
      await this.agent.prompt(messages);
      while (!this.agentRunAbortRequested) {
        if (await this.handlePostAgentRun()) {
          if (this.agentRunAbortRequested) break;
          await this.agent.continue();
          continue;
        }
        if (this.agentRunAbortRequested) break;
        const continueRun =
          (await this.runBeforeSettleBoundary()) ||
          (!this.agentRunAbortRequested && (await this.goalInternal.afterRun()));
        if (!continueRun || this.agentRunAbortRequested) break;
        await this.agent.continue();
      }
    } finally {
      if (this.agentRunAbortRequested) this.finishCancelledRetry();
      this.failedResponse = undefined;
      this.runSystemPromptOptions = undefined;
      this.flushPendingBashMessages();
      this.flushPendingCustomMessages();
      await this.emitAgentSettled();
    }
  }

  private async prepareRun(trigger: BeforeAgentStartTrigger): Promise<AgentMessage[]> {
    const lastAssistant = this.findLastAssistantMessage();
    if (lastAssistant !== undefined) {
      await this.checkCompaction(lastAssistant, false);
    }

    const selectedToolsBefore = this.baseSystemPromptOptions.selectedTools;
    const result = await this.extensionRunnerInternal.emitBeforeAgentStart(
      trigger,
      this.baseSystemPromptOptions,
    );
    const handlerEditedTools =
      result.systemPromptOptions.selectedTools.length !== selectedToolsBefore.length ||
      result.systemPromptOptions.selectedTools.some(
        (name, index) => name !== selectedToolsBefore[index],
      );
    if (!handlerEditedTools) result.systemPromptOptions.selectedTools = this.getActiveToolNames();

    const messages: AgentMessage[] = [];
    if (trigger.messageType === "custom") {
      messages.push(trigger.message);
    } else {
      const normalized = await this.normalizePromptImages(trigger.images);
      const text =
        normalized.hints.length > 0
          ? `${trigger.prompt}\n\n${normalized.hints.join("\n")}`
          : trigger.prompt;
      messages.push({
        role: "user",
        content: [{ type: "text", text }, ...normalized.images],
        timestamp: Date.now(),
      });
      if (this.memoryInternal !== undefined) {
        const recalled = await this.memoryInternal.recall(trigger.prompt);
        if (recalled.length > 0) {
          messages.unshift({
            role: "custom",
            customType: MEMORY_RECALL_MESSAGE_TYPE,
            content: formatRecallBlock(recalled),
            display: false,
            timestamp: Date.now(),
          });
        }
      }
    }
    messages.push(...this.pendingNextTurnMessages);
    this.pendingNextTurnMessages = [];
    for (const msg of result.messages) {
      messages.push({
        role: "custom",
        customType: msg.customType,
        content: msg.content ?? [],
        display: msg.display,
        details: msg.details,
        timestamp: Date.now(),
      });
    }
    const updateMessage = this.preparePromptAndToolLoadout(result.systemPromptOptions);
    this.runSystemPromptOptions = result.systemPromptOptions;
    if (updateMessage !== undefined) messages.unshift(updateMessage);
    return messages;
  }

  private async handlePostAgentRun(): Promise<boolean> {
    const message = this.lastAssistantMessage;
    const toolResults = this.lastAssistantToolResults;
    this.lastAssistantMessage = undefined;
    this.lastAssistantToolResults = [];
    if (this.agentRunAbortRequested) {
      this.finishCancelledRetry();
      return false;
    }
    if (message === undefined) return this.agent.hasQueuedMessages();

    if (this.isRetryableError(message) && (await this.prepareRetry(message))) {
      if (this.agentRunAbortRequested) this.finishCancelledRetry();
      this.failedResponse = message;
      return !this.agentRunAbortRequested;
    }
    if (this.agentRunAbortRequested) {
      this.finishCancelledRetry();
      return false;
    }

    if (message.stopReason === "error" && this.retryAttemptInternal > 0) {
      this.emit({
        type: "auto_retry_end",
        success: false,
        attempt: this.retryAttemptInternal,
        finalError: message.errorMessage,
      });
      this.retryAttemptInternal = 0;
    }

    if (await this.checkCompaction(message, true, toolResults)) {
      return !this.agentRunAbortRequested;
    }

    return !this.agentRunAbortRequested && this.agent.hasQueuedMessages();
  }

  private async runBeforeSettleBoundary(): Promise<boolean> {
    if (!this.extensionRunnerInternal.hasHandlers("agent_before_settle"))
      return this.agent.hasQueuedMessages();
    this.isBeforeSettle = true;
    this.abortDuringBeforeSettle = false;
    try {
      const result = await this.extensionRunnerInternal.emitBoundary(
        { type: "agent_before_settle", outcome: this.lastActivityOutcome },
        (entries) => this.buildBoundaryContext(entries, "agent_before_settle"),
      );
      this.commitBoundaryDrafts(result.entries);
      this.flushPendingCustomMessages();
      const finalContext = this.buildBoundaryContext([], "agent_before_settle");
      if (this.abortDuringBeforeSettle) return false;
      const shouldContinue = result.continue || this.agent.hasQueuedMessages();
      if (shouldContinue && !finalContext.canContinue) {
        if (result.continue) this.reportInvalidBoundaryContinuation("agent_before_settle");
        return false;
      }
      return shouldContinue;
    } finally {
      this.isBeforeSettle = false;
    }
  }

  private async runInputHandlers(
    text: string,
    images: ImageContent[] | undefined,
    source: InputSource,
    streamingBehavior?: "steer" | "followUp",
  ): Promise<{ text: string; images: ImageContent[] | undefined } | undefined> {
    if (!this.extensionRunnerInternal.hasHandlers("input")) {
      return { text, images };
    }

    const inputResult = await this.extensionRunnerInternal.emitInput(
      text,
      images,
      source,
      streamingBehavior,
    );
    if (inputResult.action === "handled") {
      return undefined;
    }
    if (inputResult.action === "transform") {
      return { text: inputResult.text, images: inputResult.images ?? images };
    }
    return { text, images };
  }

  private async normalizePromptImages(
    images: ImageContent[] | undefined,
  ): Promise<{ images: ImageContent[]; hints: string[] }> {
    if (images === undefined) return { images: [], hints: [] };

    const normalizedImages: ImageContent[] = [];
    const hints: string[] = [];
    for (const image of images) {
      const processed = await processImage(Buffer.from(image.data, "base64"), image.mimeType, {
        autoResizeImages: this.settingsManager.getImageAutoResize(),
        resizeOptions: this.limitsModel()?.inputLimits?.images?.resize,
      });
      if (!processed.ok) {
        hints.push(processed.message);
        continue;
      }
      normalizedImages.push({ type: "image", data: processed.data, mimeType: processed.mimeType });
      hints.push(...processed.hints);
    }
    return { images: normalizedImages, hints };
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    if (this.isEmittingAgentSettled) {
      this.deferredSettledActions.push(async () => await this.prompt(text, options));
      return;
    }
    const expandPromptTemplates = options?.expandPromptTemplates ?? true;
    const preflightResult = options?.preflightResult;
    const goalCommand = expandPromptTemplates ? parseGoalCommand(text) : undefined;
    if (goalCommand !== undefined) {
      await this.runGoalCommand(goalCommand, options);
      return;
    }
    const memoryCommand = expandPromptTemplates ? parseMemoryCommand(text) : undefined;
    if (memoryCommand !== undefined) {
      await this.runMemoryCommand(memoryCommand, options);
      return;
    }
    if (expandPromptTemplates && text.startsWith("/")) {
      const handled = await this.tryExecuteExtensionCommand(text);
      if (handled) {
        preflightResult?.("handled");
        return;
      }
    }

    if (this.compactionAbortController !== undefined) {
      throw new Error(
        "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
      );
    }

    const processedInput = await this.runInputHandlers(
      text,
      options?.images,
      options?.source ?? "interactive",
      this.isStreaming ? options?.streamingBehavior : undefined,
    );
    if (processedInput === undefined) {
      preflightResult?.("handled");
      return;
    }
    const { text: currentText, images: currentImages } = processedInput;

    let expandedText = currentText;
    if (expandPromptTemplates) {
      expandedText = this.expandSkillCommand(expandedText);
      expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
    }

    if (this.isStreaming) {
      if (options?.streamingBehavior === undefined) {
        throw new Error(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        );
      }
      if (options.streamingBehavior === "followUp") {
        await this.queueFollowUp(expandedText, currentImages);
      } else {
        await this.queueSteer(expandedText, currentImages);
      }
      preflightResult?.("queued");
      return;
    }

    if (this.model === undefined) {
      throw new Error(formatNoModelSelectedMessage());
    }

    const hasConfiguredAuth =
      this.modelRuntimeInternal.hasConfiguredAuth(this.model.provider) ||
      (await this.modelRuntimeInternal.checkAuth(this.model.provider)) !== undefined;
    if (!hasConfiguredAuth) {
      const isOAuth = this.modelRuntimeInternal.isUsingOAuth(this.model.provider);
      if (isOAuth) {
        throw new Error(
          `Authentication failed for "${this.model.provider}". ` +
            `Credentials may have expired or network is unavailable. ` +
            `Run '/login ${this.model.provider}' to re-authenticate.`,
        );
      }
      throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
    }

    await this.startRun({ messageType: "user", prompt: expandedText, images: currentImages }, () =>
      preflightResult?.("started"),
    );
  }

  private async tryExecuteExtensionCommand(text: string): Promise<boolean> {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

    const command = this.extensionRunnerInternal.getCommand(commandName);
    if (command === undefined || this.isSkillCommand(text)) return false;

    const ctx = this.extensionRunnerInternal.createCommandContext();

    try {
      await command.handler(args, ctx);
      return true;
    } catch (err) {
      this.extensionRunnerInternal.emitError({
        extensionPath: `command:${commandName}`,
        event: "command",
        error: toErrorMessage(err),
      });
      return true;
    }
  }

  private isSkillCommand(text: string): boolean {
    const name = slashCommandName(text);
    return this.resourceLoader.getSkills().skills.some((skill) => skill.name === name);
  }

  private expandSkillCommand(text: string): string {
    if (!text.startsWith("/")) return text;

    const spaceIndex = text.indexOf(" ");
    const skillName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

    const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
    if (skill === undefined) return text;

    try {
      const content = readFileSync(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
      return args === "" ? skillBlock : `${skillBlock}\n\n${args}`;
    } catch (err) {
      this.extensionRunnerInternal.emitError({
        extensionPath: skill.filePath,
        event: "skill_expansion",
        error: toErrorMessage(err),
      });
      return text;
    }
  }

  private async queueUserInput(
    text: string,
    images: ImageContent[] | undefined,
    behavior: "steer" | "followUp",
    source: InputSource,
  ): Promise<QueuedInputDisposition> {
    if (text.startsWith("/")) {
      this.throwIfExtensionCommand(text);
    }

    const processedInput = await this.runInputHandlers(
      text,
      images,
      source,
      this.isStreaming ? behavior : undefined,
    );
    if (processedInput === undefined) return "handled";

    let expandedText = this.expandSkillCommand(processedInput.text);
    expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

    if (behavior === "steer") {
      await this.queueSteer(expandedText, processedInput.images);
    } else {
      await this.queueFollowUp(expandedText, processedInput.images);
    }
    return "queued";
  }

  async steer(
    text: string,
    images?: ImageContent[],
    options?: { source?: InputSource },
  ): Promise<QueuedInputDisposition> {
    return this.queueUserInput(text, images, "steer", options?.source ?? "interactive");
  }

  async followUp(
    text: string,
    images?: ImageContent[],
    options?: { source?: InputSource },
  ): Promise<QueuedInputDisposition> {
    return this.queueUserInput(text, images, "followUp", options?.source ?? "interactive");
  }

  private async queueSteer(text: string, images?: ImageContent[]): Promise<void> {
    this.steeringMessages.push(text);
    this.emitQueueUpdate();
    const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
    if (images !== undefined) {
      content.push(...images);
    }
    this.agent.steer({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  private async queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
    this.followUpMessages.push(text);
    this.emitQueueUpdate();
    const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
    if (images !== undefined) {
      content.push(...images);
    }
    this.agent.followUp({ role: "user", content, timestamp: Date.now() });
  }

  private throwIfExtensionCommand(text: string): void {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const command = this.extensionRunnerInternal.getCommand(commandName);

    if (command !== undefined && !this.isSkillCommand(text)) {
      throw new Error(
        `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
      );
    }
  }

  async sendCustomMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void> {
    const appMessage = {
      role: "custom" as const,
      customType: message.customType,
      content: message.content ?? [],
      display: message.display,
      details: message.details,
      timestamp: Date.now(),
    } satisfies CustomMessage<T>;
    if (options?.deliverAs === "nextTurn") {
      this.pendingNextTurnMessages.push(appMessage);
    } else if (this.isStreaming && options?.triggerTurn !== false) {
      if (options?.deliverAs === "followUp") {
        this.agent.followUp(appMessage);
      } else {
        this.agent.steer(appMessage);
      }
    } else if (options?.triggerTurn === true) {
      if (this.isEmittingAgentSettled) {
        this.deferredSettledActions.push(
          async () => await this.sendCustomMessage(message, options),
        );
        return;
      }
      await this.startRun({ messageType: "custom", message: appMessage });
    } else if (this.isStreaming) {
      this.pendingCustomMessages.push(appMessage);
    } else {
      this.appendCustomMessage(appMessage);
    }
  }

  private appendCustomMessage(appMessage: CustomMessage): void {
    this.sessionManager.appendCustomMessageEntry(
      appMessage.customType,
      appMessage.content,
      appMessage.display,
      appMessage.details,
    );
    this.refreshFinalizedContext();
    this.emit({ type: "message_start", message: appMessage });
    this.emit({ type: "message_end", message: appMessage });
  }

  private flushPendingCustomMessages(): void {
    if (this.pendingCustomMessages.length === 0) return;

    const pending = this.pendingCustomMessages;
    this.pendingCustomMessages = [];
    for (const appMessage of pending) {
      this.appendCustomMessage(appMessage);
    }
  }

  async sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): Promise<void> {
    let text: string;
    let images: ImageContent[] | undefined;

    if (typeof content === "string") {
      text = content;
    } else {
      const textParts: string[] = [];
      images = [];
      for (const part of content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else {
          images.push(part);
        }
      }
      text = textParts.join("\n");
      if (images.length === 0) images = undefined;
    }

    await this.prompt(text, {
      expandPromptTemplates: options?.expandPromptTemplates ?? false,
      streamingBehavior: options?.deliverAs,
      images,
      source: "extension",
    });
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this.steeringMessages];
    const followUp = [...this.followUpMessages];
    this.steeringMessages = [];
    this.followUpMessages = [];
    this.agent.clearAllQueues();
    this.emitQueueUpdate();
    return { steering, followUp };
  }

  get pendingMessageCount(): number {
    return this.steeringMessages.length + this.followUpMessages.length;
  }

  getSteeringMessages(): readonly string[] {
    return this.steeringMessages;
  }

  getFollowUpMessages(): readonly string[] {
    return this.followUpMessages;
  }

  get resourceLoader(): ResourceLoader {
    return this.resourceLoaderInternal;
  }

  async abort(): Promise<void> {
    if (this.isAgentRunActive) {
      this.agentRunAbortRequested = true;
    }
    this.abortRetry();
    this.abortCompaction();
    this.abortBranchSummary();
    this.goalInternal.abort();
    if (this.isBeforeSettle) this.abortDuringBeforeSettle = true;
    this.agent.abort();
    await this.waitForIdle();
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle) {
      return;
    }
    await this.getIdleWaitPromise();
  }

  get orchestrator(): Orchestrator | undefined {
    return this.orchestratorInternal;
  }

  get memory(): MemoryService | undefined {
    return this.memoryInternal;
  }

  get goal(): GoalSnapshot | undefined {
    return this.goalInternal.snapshot;
  }

  setGoal(condition: string): void {
    this.goalInternal.set(condition);
  }

  clearGoal(): boolean {
    return this.goalInternal.clear();
  }

  private async runGoalCommand(command: GoalCommand, options?: PromptOptions): Promise<void> {
    if (command.kind === "set") {
      this.goalInternal.set(command.condition);
      const goal = this.goalInternal.snapshot;
      if (goal === undefined) return;
      await this.prompt(goal.condition, {
        ...options,
        expandPromptTemplates: false,
        streamingBehavior: options?.streamingBehavior ?? "steer",
      });
      return;
    }
    if (command.kind === "status" || !this.goalInternal.clear()) {
      this.emit({ type: "goal_status", goal: this.goalInternal.snapshot });
    }
    options?.preflightResult?.("handled");
  }

  private recordGoalEntry(data: GoalEntryData): void {
    const entry = this.sessionManager.getEntry(
      this.sessionManager.appendCustomEntry(GOAL_ENTRY_TYPE, data),
    );
    if (entry !== undefined) this.emit({ type: "entry_appended", entry });
  }

  private async runMemoryCommand(command: MemoryCommand, options?: PromptOptions): Promise<void> {
    const memory = this.memoryInternal;
    let text: string;
    if (memory === undefined) {
      text = "Memory is disabled (settings: memory.enabled).";
    } else {
      switch (command.kind) {
        case "status":
          text = memory.describeStatus();
          break;
        case "stats":
          text = memory.describeStats();
          break;
        case "list":
          text = formatMemoryList(memory.list(20));
          break;
        case "search":
          text = formatSearchResults(await memory.search(command.query, 10));
          break;
        case "forget":
          text = memory.forget(command.id)
            ? `Forgot memory ${command.id}.`
            : `No memory with id ${command.id}.`;
          break;
      }
    }
    this.emit({ type: "memory_status", text });
    options?.preflightResult?.("handled");
  }

  private totalSessionTokens(): number {
    const entryCount = this.sessionManager.getEntryCount();
    if (this.totalTokensCache?.entryCount !== entryCount) {
      this.totalTokensCache = { entryCount, total: this.getSessionStats().tokens.total };
    }
    return this.totalTokensCache.total;
  }

  private resolveOrchestratorModel(reference: string): Model<any> {
    const result = resolveModelReference(
      { text: reference, thinkingSuffix: "none", fuzzy: false },
      this.modelRuntimeInternal.getAvailableSnapshot(),
      () => true,
    );
    if (result.status !== "resolved") throw new Error(`"${reference}" is not an available model`);
    return result.model;
  }

  private orchestratorDefaults(): OrchestratorDefaults {
    const current = this.model;
    if (current === undefined) throw new Error(formatNoModelSelectedMessage());
    const currentReference = `${current.provider}/${current.id}`;
    return {
      workerModel: this.settingsManager.getOrchestratorWorkerModel() ?? currentReference,
      workerThinkingLevel:
        this.settingsManager.getOrchestratorWorkerThinkingLevel() ?? this.thinkingLevel,
      reviewModel: this.settingsManager.getOrchestratorReviewModel() ?? currentReference,
      reviewThinkingLevel:
        this.settingsManager.getOrchestratorReviewThinkingLevel() ?? this.thinkingLevel,
      maxConcurrentSessions: this.settingsManager.getOrchestratorMaxConcurrentSessions(),
    };
  }

  private goalEvaluatorModel(): Model<any> {
    const configured = this.settingsManager.getGoalEvaluatorModel();
    const available = this.modelRuntimeInternal.getAvailableSnapshot();
    if (configured !== undefined && configured !== "") {
      const result = resolveModelReference(
        { text: configured, thinkingSuffix: "none", fuzzy: false },
        available,
        () => true,
      );
      if (result.status !== "resolved") {
        throw new Error(`goal.evaluatorModel "${configured}" is not an available model`);
      }
      return result.model;
    }
    const current = this.limitsModel();
    if (current === undefined) throw new Error(formatNoModelSelectedMessage());
    return pickEvaluatorModel(current, available);
  }

  private async evaluateGoal(prompt: string, signal: AbortSignal): Promise<string> {
    const {
      model,
      thinkingLevel: _thinkingLevel,
      ...credentials
    } = await this.getSummarizationRequestAuth(this.goalEvaluatorModel(), signal);
    const response = await completeSummarization(
      model,
      normalizeContext({
        systemPrompt: GOAL_EVALUATOR_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
        ],
      }),
      {
        ...credentials,
        maxTokens: Math.min(2048, model.maxTokens > 0 ? model.maxTokens : 2048),
        signal,
        sessionId: this.sessionId,
      },
      this.agent.streamFunction,
      this.settingsManager.getRetrySettings(),
    );
    if (response.usage !== undefined) {
      const entry = this.sessionManager.appendUsage(
        "goal_evaluation",
        response.provider,
        response.model,
        response.usage,
      );
      this.emit({ type: "entry_appended", entry });
    }
    if (response.stopReason === "aborted") throw new Error("cancelled");
    if (response.stopReason === "error") throw new Error(response.errorMessage || "Unknown error");
    if (response.stopReason === "length") throw new Error("the response hit the token cap");
    return contentText(response.content, "\n").trim();
  }

  private async emitModelSelect(
    nextModel: Model<any>,
    previousModel: Model<any> | undefined,
    source: "set" | "cycle" | "restore",
  ): Promise<void> {
    if (modelsAreEqual(previousModel, nextModel)) return;
    await this.extensionRunnerInternal.emit({
      type: "model_select",
      model: nextModel,
      previousModel,
      source,
    });
  }

  async setModel(model: Model<any>, options: ModelMutationOptions = {}): Promise<void> {
    if ((await this.modelRuntimeInternal.checkAuth(model.provider)) === undefined) {
      throw new Error(`No API key for ${model.provider}/${model.id}`);
    }

    const previousModel = this.model;
    const thinkingLevel = this.getThinkingLevelForModelSwitch(model);
    this.agent.state.model = model;
    this.sessionManager.appendModelChange(model.provider, model.id);
    if (options.persist === true) {
      this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
      this.addPersistedDefaultToNonEmptyScope(model);
    }

    this.setThinkingLevel(thinkingLevel);

    await this.emitModelSelect(model, previousModel, "set");
  }

  private addPersistedDefaultToNonEmptyScope(model: Model<any>): void {
    if (this.scopedModelsInternal.length === 0) return;
    if (this.scopedModelsInternal.some((scoped) => modelsAreEqual(scoped.model, model))) return;

    this.scopedModelsInternal = [...this.scopedModelsInternal, { model }];

    const enabledModels = this.settingsManager.getEnabledModels();
    if (enabledModels?.length === undefined || enabledModels?.length === 0) return;

    const modelReference = `${model.provider}/${model.id}`;
    if (enabledModels.some((pattern) => pattern.toLowerCase() === modelReference.toLowerCase()))
      return;
    this.settingsManager.setEnabledModels([...enabledModels, modelReference]);
  }

  async cycleModel(
    direction: "forward" | "backward" = "forward",
    options: ModelMutationOptions = {},
  ): Promise<ModelCycleResult | undefined> {
    if (this.scopedModelsInternal.length > 0) {
      return this.cycleScopedModel(direction, options);
    }
    return this.cycleAvailableModel(direction, options);
  }

  private async cycleScopedModel(
    direction: "forward" | "backward",
    options: ModelMutationOptions,
  ): Promise<ModelCycleResult | undefined> {
    const availableIds = new Set(
      this.modelRuntimeInternal
        .getAvailableSnapshot()
        .map((model) => `${model.provider}\0${model.id}`),
    );
    const scopedModels = this.scopedModelsInternal.filter((scoped) =>
      availableIds.has(`${scoped.model.provider}\0${scoped.model.id}`),
    );
    if (scopedModels.length <= 1) return undefined;

    const currentModel = this.model;
    let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

    if (currentIndex === -1) currentIndex = 0;
    const len = scopedModels.length;
    const nextIndex =
      direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
    const next = scopedModels[nextIndex];
    if (next === undefined) return undefined;
    const thinkingLevel = this.getThinkingLevelForModelSwitch(next.model, next.thinkingLevel);

    this.agent.state.model = next.model;
    this.sessionManager.appendModelChange(next.model.provider, next.model.id);
    if (options.persist === true) {
      this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
      this.addPersistedDefaultToNonEmptyScope(next.model);
    }

    this.setThinkingLevel(thinkingLevel);

    await this.emitModelSelect(next.model, currentModel, "cycle");

    return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
  }

  private async cycleAvailableModel(
    direction: "forward" | "backward",
    options: ModelMutationOptions,
  ): Promise<ModelCycleResult | undefined> {
    const availableModels = this.modelRuntimeInternal.getAvailableSnapshot();
    if (availableModels.length <= 1) return undefined;

    const currentModel = this.model;
    let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

    if (currentIndex === -1) currentIndex = 0;
    const len = availableModels.length;
    const nextIndex =
      direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
    const nextModel = availableModels[nextIndex];
    if (nextModel === undefined) return undefined;

    const thinkingLevel = this.getThinkingLevelForModelSwitch(nextModel);
    this.agent.state.model = nextModel;
    this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
    if (options.persist === true) {
      this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
      this.addPersistedDefaultToNonEmptyScope(nextModel);
    }

    this.setThinkingLevel(thinkingLevel);

    await this.emitModelSelect(nextModel, currentModel, "cycle");

    return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
  }

  setThinkingLevel(level: ThinkingLevel, options: ModelMutationOptions = {}): void {
    const availableLevels = this.getAvailableThinkingLevels();
    const effectiveLevel = availableLevels.includes(level)
      ? level
      : this.clampThinkingLevel(level, availableLevels);

    const previousLevel = this.agent.state.thinkingLevel;
    const isChanging = effectiveLevel !== previousLevel;

    this.agent.state.thinkingLevel = effectiveLevel;

    if (options.persist === true) {
      this.settingsManager.setDefaultThinkingLevel(level);
    }

    if (isChanging) {
      this.sessionManager.appendThinkingLevelChange(effectiveLevel);
      this.emit({ type: "thinking_level_changed", level: effectiveLevel });
      void this.extensionRunnerInternal.emit({
        type: "thinking_level_select",
        level: effectiveLevel,
        previousLevel,
      });
    }
  }

  cycleThinkingLevel(options: ModelMutationOptions = {}): ThinkingLevel | undefined {
    if (!this.supportsThinking()) return undefined;

    const levels = this.getAvailableThinkingLevels();
    const currentIndex = levels.indexOf(this.thinkingLevel);
    const nextIndex = (currentIndex + 1) % levels.length;
    const nextLevel = levels[nextIndex];
    if (nextLevel === undefined) return undefined;

    this.setThinkingLevel(nextLevel, options);
    return nextLevel;
  }

  getAvailableThinkingLevels(): ThinkingLevel[] {
    if (this.model === undefined) return [...THINKING_LEVEL_OPTIONS];
    return getSupportedThinkingLevels(this.model) as ThinkingLevel[];
  }

  supportsThinking(): boolean {
    return this.model?.reasoning === true;
  }

  private getThinkingLevelForModelSwitch(
    targetModel?: Model<any>,
    explicitLevel?: ThinkingLevel,
  ): ThinkingLevel {
    if (explicitLevel !== undefined) {
      return explicitLevel;
    }
    if (targetModel !== undefined) {
      const perModel = this.settingsManager.getModelThinkingLevel(
        targetModel.provider,
        targetModel.id,
      );
      if (perModel !== undefined) {
        return perModel;
      }
    }
    return (
      this.settingsManager.getDefaultThinkingLevel() ?? this.thinkingLevel ?? DEFAULT_THINKING_LEVEL
    );
  }

  private clampThinkingLevel(
    level: ThinkingLevel,
    _availableLevels: ThinkingLevel[],
  ): ThinkingLevel {
    return this.model === undefined
      ? "off"
      : (clampThinkingLevel(this.model, level) as ThinkingLevel);
  }

  private syncQueueModesFromSettings(): void {
    this.agent.steeringMode = this.settingsManager.getSteeringMode();
    this.agent.followUpMode = this.settingsManager.getFollowUpMode();
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.agent.steeringMode = mode;
    this.settingsManager.setSteeringMode(mode);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.agent.followUpMode = mode;
    this.settingsManager.setFollowUpMode(mode);
  }

  private async runDefaultCompaction(
    preparation: CompactionPreparation,
    model: Model<any>,
    customInstructions: string | undefined,
    signal: AbortSignal,
    reason: "manual" | "threshold" | "overflow",
  ): Promise<CompactionResult> {
    const request = await this.getSummarizationRequestAuth(model, signal);
    return compact(
      preparation,
      request.model,
      request.apiKey,
      request.headers,
      customInstructions,
      signal,
      request.thinkingLevel,
      this.agent.streamFunction,
      request.env,
      this.settingsManager.getRetrySettings(),
      this.summarizationRetryCallbacks({ source: "compaction", reason }),
      undefined,
    );
  }

  private clearManualCompactionState(): void {
    this.compactionAbortController = undefined;
    this.resolveIdleWaitIfIdle();
  }

  async compact(customInstructions?: string): Promise<CompactionResult> {
    await this.abort();
    this.compactionAbortController = new AbortController();
    this.emit({ type: "compaction_start", reason: "manual" });
    let fromExtension = false;
    let cancelledByExtension = false;

    try {
      const model = this.model;
      if (model === undefined) {
        throw new Error(formatNoModelSelectedMessage());
      }

      const settings = this.settingsManager.getCompactionSettings(model);
      const pathEntries = this.sessionManager.getBranch();

      const preparation = prepareCompaction(pathEntries, settings);
      if (preparation === undefined) {
        const lastEntry = pathEntries[pathEntries.length - 1];
        if (lastEntry?.type === "compaction") {
          throw new Error("Already compacted");
        }
        throw new Error("Nothing to compact (session too small)");
      }

      let extensionCompaction: CompactionResult | undefined;

      if (this.extensionRunnerInternal.hasHandlers("session_before_compact")) {
        const result = (await this.extensionRunnerInternal.emit({
          type: "session_before_compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions,
          reason: "manual",
          willRetry: false,
          signal: this.compactionAbortController.signal,
        })) as SessionBeforeCompactResult | undefined;

        if (result?.cancel === true) {
          cancelledByExtension = true;
          throw new Error("Compaction cancelled");
        }

        if (result?.compaction !== undefined) {
          extensionCompaction = result.compaction;
          fromExtension = true;
        }
      }

      let summary: string;
      let firstKeptEntryId: string;
      let tokensBefore: number;
      let usage: Usage | undefined;
      let details: unknown;

      if (extensionCompaction === undefined) {
        const result = await this.runDefaultCompaction(
          preparation,
          model,
          customInstructions,
          this.compactionAbortController.signal,
          "manual",
        );
        summary = result.summary;
        firstKeptEntryId = result.firstKeptEntryId;
        tokensBefore = result.tokensBefore;
        usage = result.usage;
        details = result.details;
      } else {
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        usage = extensionCompaction.usage;
        details = extensionCompaction.details;
      }

      if (this.compactionAbortController.signal.aborted) {
        throw new Error("Compaction cancelled");
      }

      this.sessionManager.appendCompaction(
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
        fromExtension,
        usage,
      );
      const newEntries = this.sessionManager.getEntries();
      this.refreshFinalizedContext();
      const estimatedTokensAfter = estimateMessagesTokens(
        this.sessionManager.buildSessionProjection().messages,
      );

      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as CompactionEntry | undefined;

      if (savedCompactionEntry !== undefined) {
        await this.extensionRunnerInternal.emit({
          type: "session_compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
          reason: "manual",
          willRetry: false,
        });
      }

      const compactionResult: CompactionResult = {
        summary,
        firstKeptEntryId,
        tokensBefore,
        estimatedTokensAfter,
        usage,
        details,
      };
      this.clearManualCompactionState();
      this.emit({
        type: "compaction_end",
        reason: "manual",
        result: compactionResult,
        aborted: false,
        willRetry: false,
      });
      return compactionResult;
    } catch (error) {
      const message = toErrorMessage(error);
      const aborted = this.compactionAbortController.signal.aborted || cancelledByExtension;
      const errorMessage = aborted ? undefined : `Compaction failed: ${message}`;
      this.clearManualCompactionState();
      this.emit({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted,
        willRetry: false,
        errorMessage,
      });
      await this.emitSessionCompactFailed({
        reason: "manual",
        errorMessage,
        aborted,
        willRetry: false,
        fromExtension,
      });
      throw error;
    } finally {
      this.clearManualCompactionState();
    }
  }

  abortCompaction(): void {
    this.compactionAbortController?.abort();
    this.autoCompactionAbortController?.abort();
  }

  abortBranchSummary(): void {
    this.branchSummaryAbortController?.abort();
  }

  private async checkCompaction(
    assistantMessage: AssistantMessage,
    skipAbortedCheck = true,
    toolResults: AgentMessage[] = [],
  ): Promise<boolean> {
    const settings = this.settingsManager.getCompactionSettings(this.model);
    if (!settings.enabled) return false;

    if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

    const messageModel = this.modelForMessage(assistantMessage);
    const sameModel = messageModel !== undefined;
    const contextWindow = (messageModel ?? this.model)?.contextWindow ?? 0;

    const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
    const assistantIsFromBeforeCompaction =
      compactionEntry !== null &&
      assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
    if (assistantIsFromBeforeCompaction) {
      return false;
    }

    const currentProjection = this.sessionManager.buildSessionProjection();
    const assistantEntryId = this.findPersistedMessageEntryId(assistantMessage);
    const assistantIsProjected =
      assistantEntryId === undefined ||
      currentProjection.entries.some(
        (entry) =>
          entry.sourceEntry.id === assistantEntryId &&
          entry.messages.some((message) => message.role === "assistant"),
      );
    const branch = this.sessionManager.getBranch();
    const assistantIndex =
      assistantEntryId !== undefined && assistantEntryId !== ""
        ? branch.findIndex((entry) => entry.id === assistantEntryId)
        : -1;
    const entriesAfterAssistant = assistantIndex >= 0 ? branch.slice(assistantIndex + 1) : [];
    const hasPostAssistantContextEdit = entriesAfterAssistant.some(
      (entry) => entry.type === "context_edit",
    );
    const latestAssistantEdit = entriesAfterAssistant
      .filter(
        (entry): entry is ContextEditEntry =>
          entry.type === "context_edit" && entry.targetId === assistantEntryId,
      )
      .at(-1);
    const assistantRetainedForExplicitRecovery =
      assistantEntryId === undefined ||
      (!entriesAfterAssistant.some((entry) => entry.type === "compaction") &&
        latestAssistantEdit?.replacement !== null);
    const assistantUsageMatchesProjection = assistantIsProjected && !hasPostAssistantContextEdit;
    const explicitOverflow =
      assistantMessage.stopReason === "error" && isContextOverflow(assistantMessage);
    const contextOverflow =
      sameModel &&
      ((explicitOverflow && assistantRetainedForExplicitRecovery) ||
        (assistantUsageMatchesProjection && isContextOverflow(assistantMessage, contextWindow)));
    const recoverableLength =
      sameModel &&
      assistantIsProjected &&
      isRecoverableLength(assistantMessage, messageModel.maxTokens);
    if (contextOverflow || recoverableLength) {
      const willRetry = assistantMessage.stopReason !== "stop";

      if (!willRetry) {
        return await this.runAutoCompaction("overflow", false);
      }

      if (this.overflowRecoveryAttempted) {
        const errorMessage = contextOverflow
          ? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."
          : "Truncated response recovery failed after one compact-and-retry attempt.";
        this.emit({
          type: "compaction_end",
          reason: "overflow",
          result: undefined,
          aborted: false,
          willRetry: false,
          errorMessage,
        });
        await this.emitSessionCompactFailed({
          reason: "overflow",
          errorMessage,
          aborted: false,
          willRetry: false,
          fromExtension: false,
        });
        return false;
      }

      this.overflowRecoveryAttempted = true;
      this.omitRecoveryAttempt(assistantMessage, toolResults);
      const retry = await this.runAutoCompaction("overflow", willRetry);
      if (retry) this.failedResponse = assistantMessage;
      return retry;
    }

    let contextTokens: number;
    const projection = currentProjection;
    const hasContextEdits = projection.entries.some(
      (entry) => entry.sourceEntry.type === "context_edit",
    );
    const directContextTokens =
      assistantMessage.usage !== undefined ? calculateContextTokens(assistantMessage.usage) : 0;
    if (hasContextEdits) {
      contextTokens = estimateProjectedContextTokens(projection, branch).tokens;
    } else if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
      const messages = this.agent.state.messages;
      const estimate = estimateContextTokens(messages);
      if (estimate.lastUsageIndex !== null) {
        const usageMsg = messages[estimate.lastUsageIndex];
        if (
          compactionEntry !== null &&
          usageMsg?.role === "assistant" &&
          (usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()
        ) {
          return false;
        }
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = directContextTokens;
    }
    if (shouldCompact(contextTokens, contextWindow, settings)) {
      return await this.runAutoCompaction("threshold", false);
    }
    return false;
  }

  private async runAutoCompaction(
    reason: "overflow" | "threshold",
    willRetry: boolean,
  ): Promise<boolean> {
    const model = this.model;
    const settings = this.settingsManager.getCompactionSettings(model);
    let abortController: AbortController | undefined;
    let started = false;
    let fromExtension = false;
    let cancelledByExtension = false;

    try {
      if (model === undefined) {
        return false;
      }

      const pathEntries = this.sessionManager.getBranch();
      const preparation = prepareCompaction(pathEntries, settings);
      if (preparation === undefined) {
        return false;
      }

      abortController = new AbortController();
      this.autoCompactionAbortController = abortController;
      started = true;
      this.emit({ type: "compaction_start", reason });
      abortController.signal.throwIfAborted();

      let extensionCompaction: CompactionResult | undefined;

      if (this.extensionRunnerInternal.hasHandlers("session_before_compact")) {
        const extensionResult = (await this.extensionRunnerInternal.emit({
          type: "session_before_compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions: undefined,
          reason,
          willRetry,
          signal: abortController.signal,
        })) as SessionBeforeCompactResult | undefined;

        if (extensionResult?.cancel === true) {
          cancelledByExtension = true;
          throw new Error("Compaction cancelled");
        }

        if (extensionResult?.compaction !== undefined) {
          extensionCompaction = extensionResult.compaction;
          fromExtension = true;
        }
      }
      abortController.signal.throwIfAborted();

      let summary: string;
      let firstKeptEntryId: string;
      let tokensBefore: number;
      let usage: Usage | undefined;
      let details: unknown;

      if (extensionCompaction === undefined) {
        const compactResult = await this.runDefaultCompaction(
          preparation,
          model,
          undefined,
          abortController.signal,
          reason,
        );
        summary = compactResult.summary;
        firstKeptEntryId = compactResult.firstKeptEntryId;
        tokensBefore = compactResult.tokensBefore;
        usage = compactResult.usage;
        details = compactResult.details;
      } else {
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        usage = extensionCompaction.usage;
        details = extensionCompaction.details;
      }
      abortController.signal.throwIfAborted();

      this.sessionManager.appendCompaction(
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
        fromExtension,
        usage,
      );
      const newEntries = this.sessionManager.getEntries();
      this.refreshFinalizedContext();
      const estimatedTokensAfter = estimateMessagesTokens(
        this.sessionManager.buildSessionProjection().messages,
      );

      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as CompactionEntry | undefined;

      if (savedCompactionEntry !== undefined) {
        await this.extensionRunnerInternal.emit({
          type: "session_compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
          reason,
          willRetry,
        });
      }

      const result: CompactionResult = {
        summary,
        firstKeptEntryId,
        tokensBefore,
        estimatedTokensAfter,
        usage,
        details,
      };
      this.emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

      if (willRetry) return true;

      return this.agent.hasQueuedMessages();
    } catch (error) {
      const message = error instanceof Error ? error.message : "compaction failed";
      const aborted = abortController?.signal.aborted === true || cancelledByExtension;
      if (started) {
        const errorMessage = aborted
          ? undefined
          : reason === "overflow"
            ? `Context overflow recovery failed: ${message}`
            : `Auto-compaction failed: ${message}`;
        this.emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted,
          willRetry: false,
          errorMessage,
        });
        await this.emitSessionCompactFailed({
          reason,
          errorMessage,
          aborted,
          willRetry: false,
          fromExtension,
        });
      }
      return false;
    } finally {
      if (this.autoCompactionAbortController === abortController) {
        this.autoCompactionAbortController = undefined;
      }
      this.resolveIdleWaitIfIdle();
    }
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    this.settingsManager.setCompactionEnabled(enabled);
  }

  get autoCompactionEnabled(): boolean {
    return this.settingsManager.getCompactionEnabled();
  }

  async bindExtensions(bindings: ExtensionBindings): Promise<void> {
    if (bindings.uiContext !== undefined) {
      this.extensionUIContext = bindings.uiContext;
    }
    if (bindings.mode !== undefined) {
      this.extensionMode = bindings.mode;
    }
    if (bindings.commandContextActions !== undefined) {
      this.extensionCommandContextActions = bindings.commandContextActions;
    }
    if (bindings.abortHandler !== undefined) {
      this.extensionAbortHandler = bindings.abortHandler;
    }
    if (bindings.shutdownHandler !== undefined) {
      this.extensionShutdownHandler = bindings.shutdownHandler;
    }
    if (bindings.onError !== undefined) {
      this.extensionErrorListener = bindings.onError;
    }

    this.applyExtensionBindings(this.extensionRunnerInternal);
    await this.extensionRunnerInternal.emit(this.sessionStartEvent);
    this.extensionRunnerInternal.reportUnhandledMcpServers();
    await this.extendResourcesFromExtensions(
      this.sessionStartEvent.reason === "reload" ? "reload" : "startup",
    );
  }

  private async extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void> {
    if (!this.extensionRunnerInternal.hasHandlers("resources_discover")) {
      return;
    }

    const { skillPaths, promptPaths, themePaths } =
      await this.extensionRunnerInternal.emitResourcesDiscover(this.cwd, reason);

    if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
      return;
    }

    const extensionPaths: ResourceExtensionPaths = {
      skillPaths: this.buildExtensionResourcePaths(skillPaths),
      promptPaths: this.buildExtensionResourcePaths(promptPaths),
      themePaths: this.buildExtensionResourcePaths(themePaths),
    };

    this.resourceLoaderInternal.extendResources(extensionPaths);
    this.rebuildSystemPrompt(this.getActiveToolNames());
  }

  private buildExtensionResourcePaths(
    entries: Array<{ path: string; extensionPath: string }>,
  ): Array<{
    path: string;
    metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
  }> {
    return entries.map((entry) => {
      const source = this.getExtensionSourceLabel(entry.extensionPath);
      const baseDir = isSyntheticPath(entry.extensionPath)
        ? undefined
        : dirname(entry.extensionPath);
      return {
        path: entry.path,
        metadata: {
          source,
          scope: "temporary",
          origin: "top-level",
          ...(baseDir === undefined ? {} : { baseDir }),
        },
      };
    });
  }

  private getExtensionSourceLabel(extensionPath: string): string {
    if (isSyntheticPath(extensionPath)) {
      return `extension:${extensionPath.replace(/[<>]/g, "")}`;
    }
    const base = basename(extensionPath);
    const name = base.replace(/\.(ts|js)$/, "");
    return `extension:${name}`;
  }

  private applyExtensionBindings(runner: ExtensionRunner): void {
    runner.setUIContext(this.extensionUIContext, this.extensionMode);
    runner.bindCommandContext(this.extensionCommandContextActions);

    this.extensionErrorUnsubscriber?.();
    this.extensionErrorUnsubscriber =
      this.extensionErrorListener === undefined
        ? undefined
        : runner.onError(this.extensionErrorListener);
  }

  private refreshCurrentModelFromRegistry(): void {
    const currentModel = this.model;
    if (currentModel === undefined) {
      return;
    }

    const refreshedModel = this.modelRuntimeInternal.getModel(
      currentModel.provider,
      currentModel.id,
    );
    if (refreshedModel === undefined || refreshedModel === currentModel) {
      return;
    }

    this.agent.state.model = refreshedModel;
  }

  private bindExtensionCore(runner: ExtensionRunner): void {
    const getCommands = (): SlashCommandInfo[] => {
      const extensionCommands: SlashCommandInfo[] = runner
        .getRegisteredCommands()
        .map((command) => ({
          name: command.invocationName,
          description: command.description,
          source: "extension",
          sourceInfo: command.sourceInfo,
        }));

      const templates: SlashCommandInfo[] = this.promptTemplates.map((template) => ({
        name: template.name,
        description: template.description,
        source: "prompt",
        sourceInfo: template.sourceInfo,
      }));

      const skills: SlashCommandInfo[] = this.resourceLoaderInternal
        .getSkills()
        .skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          source: "skill",
          sourceInfo: skill.sourceInfo,
        }));

      return withSkillCommands([...extensionCommands, ...templates], skills);
    };

    runner.bindCore(
      {
        sendMessage: (message, options) => {
          this.sendCustomMessage(message, options).catch((err) => {
            runner.emitError({
              extensionPath: "<runtime>",
              event: "send_message",
              error: toErrorMessage(err),
            });
          });
        },
        sendUserMessage: (content, options) => {
          this.sendUserMessage(content, options).catch((err) => {
            runner.emitError({
              extensionPath: "<runtime>",
              event: "send_user_message",
              error: toErrorMessage(err),
            });
          });
        },
        appendEntry: (customType, data) => {
          const entryId = this.sessionManager.appendCustomEntry(customType, data);
          const entry = this.sessionManager.getEntry(entryId);
          if (entry !== undefined) {
            this.emit({ type: "entry_appended", entry });
          }
        },
        setSessionName: (name) => {
          this.setSessionName(name);
        },
        getSessionName: () => {
          return this.sessionManager.getSessionName();
        },
        setLabel: (entryId, label) => {
          this.sessionManager.appendLabelChange(entryId, label);
        },
        getActiveTools: () => this.getActiveToolNames(),
        getAllTools: () => this.getAllTools(),
        getSettings: () => this.settingsManager.getSettings(),
        setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
        refreshTools: () => this.refreshToolRegistry(),
        getCommands,
        setModel: async (model) => {
          if (!this.modelRuntimeInternal.hasConfiguredAuth(model.provider)) return false;
          await this.setModel(model);
          return true;
        },
        getThinkingLevel: () => this.thinkingLevel,
        setThinkingLevel: (level) => this.setThinkingLevel(level),
      },
      {
        getModel: () => this.model,
        getScopedModels: () => this.scopedModelsInternal,
        isIdle: () => this.isIdle,
        isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
        getSignal: () => this.agent.signal,
        abort: () => {
          if (this.extensionAbortHandler !== undefined) {
            this.extensionAbortHandler();
            return;
          }
          void this.abort();
        },
        hasPendingMessages: () => this.pendingMessageCount > 0,
        shutdown: () => {
          this.extensionShutdownHandler?.();
        },
        getContextUsage: () => this.getContextUsage(),
        compact: (options) => {
          void (async () => {
            try {
              const result = await this.compact(options?.customInstructions);
              options?.onComplete?.(result);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              options?.onError?.(err);
            }
          })();
        },
        getSystemPrompt: () => this.systemPrompt,
        getSystemPromptOptions: () => this.baseSystemPromptOptions,
        executeTool: (callerId, name, args, options) =>
          this.executeNestedToolCall(callerId, name, args, options),
        getCallableTools: () => this.getCallableTools(),
      },
      {
        registerProvider: (name, config) => {
          this.modelRuntimeInternal.registerProvider(name, config);
          this.refreshCurrentModelFromRegistry();
        },
        registerNativeProvider: (provider) => {
          this.modelRuntimeInternal.registerNativeProvider(provider);
          this.refreshCurrentModelFromRegistry();
        },
        unregisterProvider: (name) => {
          this.modelRuntimeInternal.unregisterProvider(name);
          this.refreshCurrentModelFromRegistry();
        },
        registerVirtualModel: (definition) => {
          this.modelRuntimeInternal.registerVirtualModel(definition);
          this.refreshCurrentModelFromRegistry();
        },
        unregisterVirtualModel: (provider, id) => {
          this.modelRuntimeInternal.unregisterVirtualModel(provider, id);
          this.refreshCurrentModelFromRegistry();
        },
      },
    );
  }

  private refreshToolRegistry(options?: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean | undefined;
  }): void {
    const previousActivatedOnRegistration = new Set(
      [...this.toolRegistry.keys()].filter((name) => this.isActivatedOnRegistration(name)),
    );
    const previousActiveToolNames = this.getActiveToolNames();
    const allowedTools = this.allowedTools;

    const registeredTools = this.extensionRunnerInternal.getAllRegisteredTools();
    const allCustomTools = [
      ...registeredTools,
      ...this.customTools.map((definition) => ({
        definition,
        sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
      })),
    ].filter((tool) => this.isAllowedTool(tool.definition.name));
    const definitionRegistry = new Map<string, ToolDefinitionEntry>(
      Array.from(this.baseToolDefinitions.entries())
        .filter(([name]) => this.isAllowedTool(name))
        .map(([name, definition]) => [
          name,
          {
            definition,
            sourceInfo: createSyntheticSourceInfo(`${BUILTIN_PATH_PREFIX}${name}`, {
              source: "builtin",
            }),
          },
        ]),
    );
    for (const tool of allCustomTools) {
      definitionRegistry.set(tool.definition.name, {
        definition: tool.definition,
        sourceInfo: tool.sourceInfo,
      });
    }
    this.toolDefinitions = definitionRegistry;
    this.toolPromptSnippets = new Map(
      Array.from(definitionRegistry.values())
        .map(({ definition }) => {
          const snippet = this.normalizePromptSnippet(definition.promptSnippet);
          return snippet !== undefined && snippet !== ""
            ? ([definition.name, snippet] as const)
            : undefined;
        })
        .filter((entry): entry is readonly [string, string] => entry !== undefined),
    );
    this.toolPromptGuidelines = new Map(
      Array.from(definitionRegistry.values())
        .map(({ definition }) => {
          const guidelines = this.normalizePromptGuidelines(definition.promptGuidelines);
          return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
        })
        .filter((entry): entry is readonly [string, string[]] => entry !== undefined),
    );
    const runner = this.extensionRunnerInternal;
    const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
    const wrappedBuiltInTools = wrapRegisteredTools(
      Array.from(this.baseToolDefinitions.values())
        .filter((definition) => this.isAllowedTool(definition.name))
        .map((definition) => ({
          definition,
          sourceInfo: createSyntheticSourceInfo(`${BUILTIN_PATH_PREFIX}${definition.name}`, {
            source: "builtin",
          }),
        })),
      runner,
    );

    const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
    for (const tool of wrappedExtensionTools as AgentTool[]) {
      toolRegistry.set(tool.name, tool);
    }
    this.toolRegistry = toolRegistry;

    const nextActiveToolNames = (
      options?.activeToolNames === undefined
        ? [...previousActiveToolNames]
        : [...options.activeToolNames]
    ).filter((name) => this.isAllowedTool(name));

    if (allowedTools !== undefined) {
      for (const toolName of this.toolRegistry.keys()) {
        if (allowedTools(toolName) && this.isDeclarable(toolName)) {
          nextActiveToolNames.push(toolName);
        }
      }
    } else if (options?.includeAllExtensionTools === true) {
      for (const tool of wrappedExtensionTools) {
        if (this.isActivatedOnRegistration(tool.name)) nextActiveToolNames.push(tool.name);
      }
    } else if (options?.activeToolNames === undefined) {
      for (const toolName of this.toolRegistry.keys()) {
        if (
          !previousActivatedOnRegistration.has(toolName) &&
          this.isActivatedOnRegistration(toolName)
        ) {
          nextActiveToolNames.push(toolName);
        }
      }
    }
    nextActiveToolNames.push(...this.pendingToolNames);

    this.setActiveTools([...new Set(nextActiveToolNames)]);
  }

  private isDeclarable(name: string): boolean {
    const exposure = this.getToolExposure(name);
    return exposure === "direct" || exposure === "model-only";
  }

  private isActivatedOnRegistration(name: string): boolean {
    return (
      this.isDeclarable(name) && this.toolDefinitions.get(name)?.definition.defaultActive !== false
    );
  }

  private buildRuntime(options: {
    activeToolNames?: string[] | undefined;
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  }): void {
    const autoResizeImages = this.settingsManager.getImageAutoResize();
    const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
    const shellPath = this.settingsManager.getShellPath();
    const memorySettings = this.settingsManager.getMemorySettings();
    this.memoryInternal?.close();
    this.memoryInternal = memorySettings.enabled
      ? new MemoryService({ settings: memorySettings, cwd: this.cwd })
      : undefined;
    this.memoryInternal?.warm();
    const baseToolDefinitions =
      this.baseToolsOverride === undefined
        ? {
            ...createAllToolDefinitions(this.cwd, {
              read: { autoResizeImages },
              bash: { commandPrefix: shellCommandPrefix, shellPath },
            }),
            ...(this.memoryInternal === undefined
              ? {}
              : { memory: createMemoryToolDefinition(this.memoryInternal) }),
          }
        : Object.fromEntries(
            Object.entries(this.baseToolsOverride).map(([name, tool]) => [
              name,
              createToolDefinitionFromAgentTool(tool),
            ]),
          );

    this.baseToolDefinitions = new Map(
      Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool as ToolDefinition]),
    );
    if (this.orchestratorInternal !== undefined && this.baseToolsOverride === undefined) {
      for (const [name, tool] of Object.entries(
        createOrchestratorToolDefinitions(this.orchestratorInternal),
      )) {
        this.baseToolDefinitions.set(name, tool);
      }
    }

    const extensionsResult = this.resourceLoaderInternal.getExtensions();
    if (options.flagValues !== undefined) {
      for (const [name, value] of options.flagValues) {
        extensionsResult.runtime.flagValues.set(name, value);
      }
    }

    this.extensionRunnerInternal = new ExtensionRunner(
      extensionsResult.extensions,
      extensionsResult.runtime,
      this.cwd,
      this.sessionManager,
      new ModelRegistry(this.modelRuntimeInternal),
    );
    if (this.extensionRunnerRef !== undefined) {
      this.extensionRunnerRef.current = this.extensionRunnerInternal;
    }
    this.bindExtensionCore(this.extensionRunnerInternal);
    this.applyExtensionBindings(this.extensionRunnerInternal);

    if (this.baseToolsOverride === undefined) this.addExternalServiceTools();

    const defaultActiveToolNames =
      this.baseToolsOverride === undefined
        ? [...DEFAULT_TOOL_NAMES]
        : Object.keys(this.baseToolsOverride);
    const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
    this.refreshToolRegistry({
      activeToolNames: baseActiveToolNames,
      includeAllExtensionTools: options.includeAllExtensionTools,
    });
  }

  getExternalServices(): ExternalService[] {
    return [...EXTERNAL_SERVICES, ...this.extensionRunnerInternal.getExternalServices()];
  }

  private addExternalServiceTools(): string[] {
    const names: string[] = [];
    for (const service of this.getExternalServices()) {
      for (const tool of service.tools?.() ?? []) {
        this.baseToolDefinitions.set(tool.name, tool);
        names.push(tool.name);
      }
    }
    return names;
  }

  refreshExternalServiceTools(): void {
    if (this.baseToolsOverride !== undefined) return;
    const names = this.addExternalServiceTools();
    const defaultTools = this.usesDefaultTools
      ? applyToolModifiers(
          this.settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES,
          this.defaultToolModifiers,
        )
      : [];
    this.refreshToolRegistry({
      activeToolNames: [
        ...this.getActiveToolNames(),
        ...names.filter((name) => defaultTools.includes(name)),
      ],
    });
  }

  async reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void> {
    const oldRunner = this.extensionRunnerInternal;
    const previousFlagValues = oldRunner.getFlagValues();
    await emitSessionShutdownEvent(oldRunner, { type: "session_shutdown", reason: "reload" });
    oldRunner.invalidate();
    const getDefaultTools = () =>
      this.usesDefaultTools
        ? applyToolModifiers(
            this.settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES,
            this.defaultToolModifiers,
          )
        : [];
    const previousDefaultTools = new Set(getDefaultTools());
    await this.settingsManager.reload();
    this.syncQueueModesFromSettings();
    resetApiProviders();
    await this.resourceLoaderInternal.reload();
    const addedDefaultTools = getDefaultTools().filter((name) => !previousDefaultTools.has(name));
    for (const name of this.getActiveToolNames()) this.pendingToolNames.add(name);
    this.buildRuntime({
      activeToolNames: [...this.getActiveToolNames(), ...addedDefaultTools],
      flagValues: previousFlagValues,
      includeAllExtensionTools: true,
    });

    const hasBindings =
      this.extensionUIContext ||
      this.extensionCommandContextActions ||
      this.extensionShutdownHandler ||
      this.extensionErrorListener;
    if (hasBindings !== undefined) {
      await options?.beforeSessionStart?.();
      await this.extensionRunnerInternal.emit({ type: "session_start", reason: "reload" });
      this.extensionRunnerInternal.reportUnhandledMcpServers();
      await this.extendResourcesFromExtensions("reload");
    }
  }

  private isRetryableError(message: AssistantMessage): boolean {
    if (
      isContextOverflow(message, (this.modelForMessage(message) ?? this.model)?.contextWindow ?? 0)
    )
      return false;
    return isRetryableAssistantError(message);
  }

  private summarizationRetryCallbacks(
    source:
      | { source: "branchSummary" }
      | { source: "compaction"; reason: "manual" | "threshold" | "overflow" },
  ): RetryCallbacks {
    return {
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
        this.emit({
          type: "summarization_retry_scheduled",
          attempt,
          maxAttempts,
          delayMs,
          errorMessage,
        });
      },
      onRetryAttemptStart: () => {
        this.emit({
          type: "summarization_retry_attempt_start",
          ...source,
        });
      },
      onRetryFinished: () => {
        this.emit({ type: "summarization_retry_finished" });
      },
    };
  }

  private finishCancelledRetry(): void {
    if (this.retryAttemptInternal === 0) return;
    const attempt = this.retryAttemptInternal;
    this.retryAttemptInternal = 0;
    this.emit({
      type: "auto_retry_end",
      success: false,
      attempt,
      finalError: "Retry cancelled",
    });
  }

  private async prepareRetry(message: AssistantMessage): Promise<boolean> {
    const settings = this.settingsManager.getRetrySettings();
    if (!settings.enabled) {
      return false;
    }

    this.retryAttemptInternal++;

    if (this.retryAttemptInternal > settings.maxRetries) {
      this.retryAttemptInternal--;
      return false;
    }

    const delayMs = retryDelayMs(settings, this.retryAttemptInternal);

    this.emit({
      type: "auto_retry_start",
      attempt: this.retryAttemptInternal,
      maxAttempts: settings.maxRetries,
      delayMs,
      errorMessage: message.errorMessage || "Unknown error",
    });

    this.omitRecoveryAttempt(message);

    this.retryAbortController = new AbortController();
    try {
      await delay(delayMs, undefined, { signal: this.retryAbortController.signal });
    } catch {
      this.finishCancelledRetry();
      return false;
    } finally {
      this.retryAbortController = undefined;
    }

    return true;
  }

  abortRetry(): void {
    this.retryAbortController?.abort();
  }

  get isRetrying(): boolean {
    return this.retryAbortController !== undefined;
  }

  get autoRetryEnabled(): boolean {
    return this.settingsManager.getRetryEnabled();
  }

  setAutoRetryEnabled(enabled: boolean): void {
    this.settingsManager.setRetryEnabled(enabled);
  }

  async executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: {
      excludeFromContext?: boolean | undefined;
      id?: string | undefined;
      operations?: BashOperations | undefined;
    },
  ): Promise<BashResult> {
    const abortController = new AbortController();
    this.bashAbortControllers.add(abortController);

    const prefix = this.settingsManager.getShellCommandPrefix();
    const shellPath = this.settingsManager.getShellPath();
    const resolvedCommand =
      prefix !== undefined && prefix !== "" ? `${prefix}\n${command}` : command;

    try {
      const result = await executeBashWithOperations(
        resolvedCommand,
        this.sessionManager.getCwd(),
        options?.operations ?? createLocalBashOperations({ shellPath }),
        {
          onChunk: (delta) => {
            onChunk?.(delta);
            this.emit({ type: "bash_execution_update", id: options?.id, delta });
          },
          signal: abortController.signal,
        },
      );

      this.recordBashResult(command, result, options);
      return result;
    } finally {
      this.bashAbortControllers.delete(abortController);
    }
  }

  recordBashResult(
    command: string,
    result: BashResult,
    options?: { excludeFromContext?: boolean | undefined },
  ): void {
    const bashMessage: BashExecutionMessage = {
      role: "bashExecution",
      command,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled,
      truncated: result.truncated,
      fullOutputPath: result.fullOutputPath,
      timestamp: Date.now(),
      excludeFromContext: options?.excludeFromContext,
    };

    if (this.isStreaming) {
      this.pendingBashMessages.push(bashMessage);
    } else {
      this.sessionManager.appendMessage(bashMessage);
      this.refreshFinalizedContext();
    }
  }

  abortBash(): void {
    for (const abortController of [...this.bashAbortControllers]) {
      abortController.abort();
    }
  }

  get isBashRunning(): boolean {
    return this.bashAbortControllers.size > 0;
  }

  get hasPendingBashMessages(): boolean {
    return this.pendingBashMessages.length > 0;
  }

  private flushPendingBashMessages(): void {
    if (this.pendingBashMessages.length === 0) return;

    for (const bashMessage of this.pendingBashMessages) {
      this.sessionManager.appendMessage(bashMessage);
    }
    this.pendingBashMessages = [];
    this.refreshFinalizedContext();
  }

  setSessionName(name: string): void {
    this.sessionManager.appendSessionInfo(name);
    const event = {
      type: "session_info_changed",
      name: this.sessionManager.getSessionName(),
    } as const;
    this.emit(event);
    void this.extensionRunnerInternal.emit(event);
  }

  async navigateTree(
    targetId: string,
    options: {
      summarize?: boolean | undefined;
      customInstructions?: string | undefined;
      replaceInstructions?: boolean | undefined;
      label?: string | undefined;
    } = {},
  ): Promise<{
    editorText?: string | undefined;
    cancelled: boolean;
    aborted?: boolean;
    summaryEntry?: BranchSummaryEntry | undefined;
  }> {
    if (this.isStreaming) {
      throw new Error(
        "Wait for the current response to finish before navigating the session tree.",
      );
    }
    if (this.isCompacting) {
      throw new Error(
        "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
      );
    }

    const oldLeafId = this.sessionManager.getLeafId();

    if (targetId === oldLeafId) {
      return { cancelled: false };
    }

    if (options.summarize === true && this.model === undefined) {
      throw new Error("No model available for summarization");
    }

    const targetEntry = this.sessionManager.getEntry(targetId);
    if (targetEntry === undefined) {
      throw new Error(`Entry ${targetId} not found`);
    }

    const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
      this.sessionManager,
      oldLeafId,
      targetId,
    );

    let customInstructions = options.customInstructions;
    let replaceInstructions = options.replaceInstructions;
    let label = options.label;

    const preparation: TreePreparation = {
      targetId,
      oldLeafId,
      commonAncestorId,
      entriesToSummarize,
      userWantsSummary: options.summarize ?? false,
      customInstructions,
      replaceInstructions,
      label,
    };

    this.branchSummaryAbortController = new AbortController();

    try {
      let extensionSummary: { summary: string; details?: unknown; usage?: Usage } | undefined;
      let fromExtension = false;

      if (this.extensionRunnerInternal.hasHandlers("session_before_tree")) {
        const result = (await this.extensionRunnerInternal.emit({
          type: "session_before_tree",
          preparation,
          signal: this.branchSummaryAbortController.signal,
        })) as SessionBeforeTreeResult | undefined;

        if (result?.cancel === true) {
          return { cancelled: true };
        }

        if (result?.summary !== undefined && options.summarize === true) {
          extensionSummary = result.summary;
          fromExtension = true;
        }

        if (result?.customInstructions !== undefined) {
          customInstructions = result.customInstructions;
        }
        if (result?.replaceInstructions !== undefined) {
          replaceInstructions = result.replaceInstructions;
        }
        if (result?.label !== undefined) {
          label = result.label;
        }
      }

      let summaryText: string | undefined;
      let summaryDetails: unknown;
      let summaryUsage: Usage | undefined;
      if (
        options.summarize === true &&
        entriesToSummarize.length > 0 &&
        extensionSummary === undefined
      ) {
        const signal = this.branchSummaryAbortController.signal;
        const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
        const result = await generateBranchSummary(entriesToSummarize, {
          ...(await this.getSummarizationRequestAuth(this.model!, signal)),
          signal,
          customInstructions,
          replaceInstructions,
          reserveTokens: branchSummarySettings.reserveTokens,
          streamFn: this.agent.streamFunction,
          retry: this.settingsManager.getRetrySettings(),
          callbacks: this.summarizationRetryCallbacks({ source: "branchSummary" }),
        });
        if (result.aborted === true) {
          return { cancelled: true, aborted: true };
        }
        if (result.error !== undefined && result.error !== "") {
          throw new Error(result.error);
        }
        summaryText = result.summary;
        summaryUsage = result.usage;
        summaryDetails = {
          readFiles: result.readFiles || [],
          modifiedFiles: result.modifiedFiles || [],
        };
      } else if (extensionSummary !== undefined) {
        summaryText = extensionSummary.summary;
        summaryDetails = extensionSummary.details;
        summaryUsage = extensionSummary.usage;
      }

      let newLeafId: string | null;
      let editorText: string | undefined;

      if (targetEntry.type === "message" && targetEntry.message.role === "user") {
        newLeafId = targetEntry.parentId;
        editorText = contentText(targetEntry.message.content, "");
      } else if (targetEntry.type === "custom_message") {
        newLeafId = targetEntry.parentId;
        editorText = contentText(targetEntry.content, "");
      } else {
        newLeafId = targetId;
      }

      let summaryEntry: BranchSummaryEntry | undefined;
      if (summaryText !== undefined && summaryText !== "") {
        const summaryId = this.sessionManager.branchWithSummary(
          newLeafId,
          summaryText,
          summaryDetails,
          fromExtension,
          summaryUsage,
        );
        summaryEntry = this.sessionManager.getEntry(summaryId) as BranchSummaryEntry;

        if (label !== undefined && label !== "") {
          this.sessionManager.appendLabelChange(summaryId, label);
        }
      } else if (newLeafId === null) {
        this.sessionManager.resetLeaf();
      } else {
        this.sessionManager.branch(newLeafId);
      }

      if (
        label !== undefined &&
        label !== "" &&
        (summaryText === undefined || summaryText === "")
      ) {
        this.sessionManager.appendLabelChange(targetId, label);
      }

      this.refreshFinalizedContext();
      this.restoreToolsFromTranscript();

      await this.extensionRunnerInternal.emit({
        type: "session_tree",
        newLeafId: this.sessionManager.getLeafId(),
        oldLeafId,
        summaryEntry,
        fromExtension: summaryText !== undefined && summaryText !== "" ? fromExtension : undefined,
      });

      return { editorText, cancelled: false, summaryEntry };
    } finally {
      this.branchSummaryAbortController = undefined;
      this.resolveIdleWaitIfIdle();
    }
  }

  getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
    const entries = this.sessionManager.getEntries();
    const result: Array<{ entryId: string; text: string }> = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      if (entry.message.role !== "user") continue;

      const text = contentText(entry.message.content, "");
      if (text !== "") {
        result.push({ entryId: entry.id, text });
      }
    }

    return result;
  }

  getSessionStats(): SessionStats {
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let totalMessages = 0;
    let toolCalls = 0;
    const usageTotals = createUsageTotals();

    for (const entry of this.sessionManager.getEntries()) {
      if (entry.type === "usage") {
        addUsageToTotals(usageTotals, entry.usage);
      } else if (
        (entry.type === "branch_summary" || entry.type === "compaction") &&
        entry.usage !== undefined
      ) {
        addUsageToTotals(usageTotals, entry.usage);
      }
      if (entry.type !== "message") continue;
      totalMessages++;
      const message = entry.message;
      if (message.role === "user") {
        userMessages++;
      } else if (message.role === "toolResult") {
        toolResults++;
        if (message.usage !== undefined) {
          addUsageToTotals(usageTotals, message.usage);
        }
      } else if (message.role === "assistant") {
        assistantMessages++;
        const assistantMsg = message as AssistantMessage;
        if (Array.isArray(assistantMsg.content)) {
          toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
        }
        addUsageToTotals(usageTotals, assistantMsg.usage);
      }
    }

    return {
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages,
      tokens: {
        input: usageTotals.input,
        output: usageTotals.output,
        cacheRead: usageTotals.cacheRead,
        cacheWrite: usageTotals.cacheWrite,
        total:
          usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite,
      },
      cost: usageTotals.cost,
      contextUsage: this.getContextUsage(),
    };
  }

  getContextUsage(): ContextUsage | undefined {
    const model = this.limitsModel();
    if (model === undefined) return undefined;

    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;

    const projection = this.sessionManager.buildSessionProjection();
    const branch = this.sessionManager.getBranch();
    const latestCompaction = getLatestCompactionEntry(branch);

    if (latestCompaction !== null) {
      const projectedAssistants = new Set(
        projection.entries.flatMap((entry) =>
          entry.messages.some(
            (message) =>
              message.role === "assistant" &&
              message.stopReason !== "aborted" &&
              message.stopReason !== "error" &&
              calculateContextTokens(message.usage) > 0,
          )
            ? [entry.sourceEntry.id]
            : [],
        ),
      );
      const compactionIndex = branch.findIndex((entry) => entry.id === latestCompaction.id);
      const hasPostCompactionUsage = branch
        .slice(compactionIndex + 1)
        .some((entry) => projectedAssistants.has(entry.id));
      if (!hasPostCompactionUsage) return { tokens: null, contextWindow, percent: null };
    }

    const estimate = estimateProjectedContextTokens(projection, branch);
    const percent = (estimate.tokens / contextWindow) * 100;

    return {
      tokens: estimate.tokens,
      contextWindow,
      percent,
    };
  }

  async exportToHtml(
    outputPath?: string,
    options: { themeName?: string | undefined } = {},
  ): Promise<string> {
    const themeName = [options.themeName, this.settingsManager.getTheme()].find(
      (candidate) => candidate !== undefined && getThemeByName(candidate) !== undefined,
    );

    const toolRenderer: ToolHtmlRenderer = createToolHtmlRenderer({
      getToolRenderers: (name) =>
        this.extensionRunnerInternal.resolveToolRenderers(name, () => this.getToolDefinition(name)),
      theme,
      cwd: this.sessionManager.getCwd(),
    });

    return await exportSessionToHtml(this.sessionManager, this.state, {
      outputPath,
      themeName,
      toolRenderer,
    });
  }

  exportToJsonl(outputPath?: string): string {
    return exportSessionToJsonl(this.sessionManager, outputPath);
  }

  async summarizeForBugReport(options: {
    hint?: string | undefined;
    signal: AbortSignal;
  }): Promise<string> {
    const model = this.model;
    if (model === undefined) {
      throw new Error("No model selected");
    }
    return generateBugReportSummary({
      ...(await this.getSummarizationRequestAuth(model, options.signal)),
      messages: this.messages,
      hint: options.hint,
      signal: options.signal,
      streamFn: this.agent.streamFunction,
      retry: this.settingsManager.getRetrySettings(),
      sessionId: this.sessionId,
    });
  }

  getLastAssistantText(): string | undefined {
    const lastAssistant = this.messages
      .slice()
      .reverse()
      .find((m) => {
        if (m.role !== "assistant") return false;
        const msg = m as AssistantMessage;
        if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
        return true;
      });

    if (lastAssistant === undefined) return undefined;

    let text = "";
    for (const content of (lastAssistant as AssistantMessage).content) {
      if (content.type === "text") {
        text += content.text;
      }
    }

    return text.trim() || undefined;
  }

  createReplacedSessionContext(): ReplacedSessionContext {
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.extensionRunnerInternal.createCommandContext()),
    ) as ReplacedSessionContext;
    context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
    context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
    return context;
  }

  hasExtensionHandlers(eventType: string): boolean {
    return this.extensionRunnerInternal.hasHandlers(eventType);
  }

  get extensionRunner(): ExtensionRunner {
    return this.extensionRunnerInternal;
  }
}
