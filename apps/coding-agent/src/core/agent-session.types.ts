import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type AgentSessionClass from "./agent-session.ts";
import type askTypes from "./ask.types.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type compactionTypes from "./compaction/index.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type goalTypes from "./goal.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type sessionTelemetryTypes from "./observability/session-telemetry.types.ts";
import type orchestratorTypes from "./orchestrator/orchestrator.types.ts";
import type serviceTypes from "./pr-watch/service.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace agentSessionTypes {
  interface ParsedSkillBlock {
    name: string;
    location: string;
    content: string;
    userMessage: string | undefined;
  }

  type WithParentToolCallId<E> = E extends {
    type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  }
    ? E & { parentToolCallId?: string }
    : E;

  type AgentSessionEvent =
    | WithParentToolCallId<Exclude<agentTypes.AgentEvent, { type: "agent_end" }>>
    | {
        type: "agent_end";
        messages: agentTypes.AgentMessage[];
        willRetry: boolean;
      }
    | { type: "agent_settled"; aborted: boolean }
    | {
        type: "queue_update";
        steering: readonly string[];
        followUp: readonly string[];
      }
    | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
    | { type: "entry_appended"; entry: sessionManagerTypes.SessionEntry }
    | { type: "session_info_changed"; name: string | undefined }
    | { type: "thinking_level_changed"; level: agentTypes.ThinkingLevel }
    | {
        type: "compaction_end";
        reason: "manual" | "threshold" | "overflow";
        result: compactionTypes.CompactionResult | undefined;
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
    | { type: "goal_changed"; goal: goalTypes.GoalSnapshot | undefined }
    | { type: "pr_watch_changed"; prWatch: serviceTypes.PrWatchSnapshot }
    | { type: "orchestrator_changed" }
    | { type: "goal_status"; goal: goalTypes.GoalSnapshot | undefined }
    | { type: "memory_status"; text: string };

  type AgentSessionEventListener = (event: AgentSessionEvent) => void;

  interface AgentSessionConfig {
    agent: agentTypes.Agent;
    sessionManager: sessionManagerTypes.SessionManager;
    settingsManager: settingsManagerTypes.SettingsManager;
    cwd: string;
    scopedModels?:
      | Array<{
          model: compatTypes.Model<any>;
          thinkingLevel?: agentTypes.ThinkingLevel | undefined;
        }>
      | undefined;
    resourceLoader: resourceLoaderTypes.ResourceLoader;
    customTools?: extensionsTypes.ToolDefinition[] | undefined;
    modelRuntime: modelRuntimeTypes.ModelRuntime;
    cacheWarmer?: Pick<
      cacheWarmerTypes.CacheWarmer,
      "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed"
    >;
    initialActiveToolNames?: string[] | undefined;
    usesDefaultTools?: boolean | undefined;
    defaultToolModifiers?: string[] | undefined;
    allowedToolNames?: string[] | undefined;
    excludedToolNames?: string[] | undefined;
    baseToolsOverride?: Record<string, agentTypes.AgentTool> | undefined;
    extensionRunnerRef?: { current?: extensionsTypes.ExtensionRunner } | undefined;
    sessionStartEvent?: extensionsTypes.SessionStartEvent | undefined;
    createWorkerSession?:
      | ((
          options: orchestratorTypes.CreateWorkerOptions,
        ) => Promise<orchestratorTypes.WorkerSession>)
      | undefined;
    telemetry?: sessionTelemetryTypes.SessionTelemetryOptions | undefined;
  }

  interface ExtensionBindings {
    uiContext?: extensionsTypes.ExtensionUIContext;
    mode?: extensionsTypes.ExtensionMode;
    commandContextActions?: extensionsTypes.ExtensionCommandContextActions;
    abortHandler?: () => void;
    shutdownHandler?: extensionsTypes.ShutdownHandler;
    onError?: extensionsTypes.ExtensionErrorListener;
  }

  type QueuedInputDisposition = "handled" | "queued";

  type PromptDisposition = QueuedInputDisposition | "started";

  interface PromptOptions {
    expandPromptTemplates?: boolean;
    images?: compatTypes.ImageContent[] | undefined;
    streamingBehavior?: "steer" | "followUp" | undefined;
    source?: extensionsTypes.InputSource;
    mode?: askTypes.PromptMode | undefined;
    preflightResult?: (disposition: PromptDisposition) => void;
  }

  interface ModelMutationOptions {
    persist?: boolean;
  }

  interface ModelCycleResult {
    model: compatTypes.Model<any>;
    thinkingLevel: agentTypes.ThinkingLevel;
    isScoped: boolean;
  }

  interface SessionStats {
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
    contextUsage?: extensionsTypes.ContextUsage | undefined;
  }

  type AgentSession = (typeof AgentSessionClass)["prototype"];
}

export type { agentSessionTypes as default };
