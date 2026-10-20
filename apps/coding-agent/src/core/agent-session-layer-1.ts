import type agentTypes from "@msa/agent-core/index.types";

import AgentSessionLayer0 from "./agent-session-layer-0.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type memoryTypes from "./memory/memory.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type nestedToolCallsTypes from "./nested-tool-calls.types.ts";
import type sessionTelemetryTypes from "./observability/session-telemetry.types.ts";
import type orchestratorTypes from "./orchestrator/orchestrator.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";

export default abstract class AgentSessionLayer1 extends AgentSessionLayer0 {
  protected orchestratorInternal: orchestratorTypes.Orchestrator | undefined;
  protected telemetry!: sessionTelemetryTypes.SessionTelemetry;
  protected totalTokensCache: { entryCount: number; total: number } | undefined;
  protected isBeforeSettle = false;
  protected abortDuringBeforeSettle = false;
  protected isEmittingAgentSettled = false;
  protected readonly deferredSettledActions: Array<() => Promise<void>> = [];
  protected resourceLoaderInternal!: resourceLoaderTypes.ResourceLoader;
  protected customTools!: extensionsTypes.ToolDefinition[];
  protected baseToolDefinitions: Map<string, extensionsTypes.ToolDefinition> = new Map();
  protected cwd!: string;
  protected extensionRunnerRef?: { current?: extensionsTypes.ExtensionRunner } | undefined;
  protected initialActiveToolNames?: string[] | undefined;
  protected pendingToolNames = new Set<string>();
  protected askRun = false;
  protected loadoutBeforeAsk: string[] = [];
  protected askVariants: Map<
    string,
    { tool: agentTypes.AgentTool; definition: extensionsTypes.ToolDefinition }
  > = new Map();
  protected usesDefaultTools = false;
  protected defaultToolModifiers: string[] = [];
  protected allowedTools?: (name: string) => boolean;
  protected allowlistFiltersMcp = false;
  protected excludedTools?: ((name: string) => boolean) | undefined;
  protected baseToolsOverride?: Record<string, agentTypes.AgentTool> | undefined;
  protected sessionStartEvent!: extensionsTypes.SessionStartEvent;
  protected extensionUIContext?: extensionsTypes.ExtensionUIContext;
  protected extensionMode: extensionsTypes.ExtensionMode = "print";
  protected extensionCommandContextActions?: extensionsTypes.ExtensionCommandContextActions;
  protected extensionAbortHandler?: () => void;
  protected extensionShutdownHandler?: extensionsTypes.ShutdownHandler;
  protected extensionErrorListener?: extensionsTypes.ExtensionErrorListener;
  protected extensionErrorUnsubscriber?: (() => void) | undefined;
  protected modelRuntimeInternal!: modelRuntimeTypes.ModelRuntime;
  protected memoryInternal: memoryTypes.MemoryService | undefined;
  protected cacheWarmer?:
    | Pick<
        cacheWarmerTypes.CacheWarmer,
        "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed"
      >
    | undefined;
  protected toolRegistry: Map<string, agentTypes.AgentTool> = new Map();
  protected nestedToolCalls: nestedToolCallsTypes.NestedToolCallRunner | undefined;
  protected hiddenDeclarations: ReadonlySet<string> = new Set();
}
