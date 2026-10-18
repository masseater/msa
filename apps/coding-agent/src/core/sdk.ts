import { join } from "node:path";

import { Agent, type AgentMessage, setDefaultStreamFn, type ThinkingLevel } from "@msa/agent-core";
import type { ModelsSimpleStreamOptions } from "@msa/ai";
import { clampThinkingLevel, type Message, type Model, streamSimple } from "@msa/ai/compat";

import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AgentSession } from "./agent-session.ts";
import { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
import { CacheWarmer } from "./cache-warmer.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type {
  ExtensionRunner,
  LoadExtensionsResult,
  SessionStartEvent,
  ToolDefinition,
} from "./extensions/index.ts";
import { createToolNameMatcher } from "./mcp-servers.ts";
import { convertToLlm } from "./messages.ts";
import { findInitialModel } from "./model-resolver.ts";
import { ModelRuntime } from "./model-runtime.ts";
import { isOrchestratorTool, ORCHESTRATOR_TOOL_NAMES } from "./orchestrator/tools.ts";
import { mergeProviderAttributionHeaders } from "./provider-attribution.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { DefaultResourceLoader } from "./resource-loader.ts";
import { getDefaultSessionDir, SessionManager } from "./session-manager.ts";
import {
  applyToolModifiers,
  DEFAULT_TOOL_NAMES,
  getToolListError,
  isToolModifier,
  SettingsManager,
} from "./settings-manager.ts";
import { time } from "./timings.ts";
import {
  createBashTool,
  createCodingTools,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createPowerShellTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  withFileMutationQueue,
} from "./tools/index.ts";
import { getBranchSelection } from "./virtual-models.ts";

setDefaultStreamFn(streamSimple);

export interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;

  modelRuntime?: ModelRuntime;

  model?: Model<any> | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  scopedModels?:
    | Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel | undefined }>
    | undefined;

  noTools?: "all" | "builtin" | undefined;
  tools?: string[] | undefined;
  excludeTools?: string[] | undefined;
  customTools?: ToolDefinition[] | undefined;

  resourceLoader?: ResourceLoader;

  sessionManager?: SessionManager;

  settingsManager?: SettingsManager;
  sessionStartEvent?: SessionStartEvent | undefined;
  orchestrator?: boolean | undefined;
}

export interface CreateAgentSessionResult {
  session: AgentSession;
  extensionsResult: LoadExtensionsResult;
  modelFallbackMessage?: string | undefined;
}

export * from "./agent-session-runtime.ts";
export type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  InlineExtension,
  SlashCommandInfo,
  SlashCommandSource,
  ToolDefinition,
} from "./extensions/index.ts";
export type { PromptTemplate } from "./prompt-templates.ts";
export type { Skill } from "./skills.ts";
export type { Tool } from "./tools/index.ts";

export {
  withFileMutationQueue,
  createCodingTools,
  createReadOnlyTools,
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  createPowerShellTool,
};

function getDefaultAgentDir(): string {
  return getAgentDir();
}

export async function createAgentSession(
  options: CreateAgentSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
  const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
  let resourceLoader = options.resourceLoader;

  const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
  const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
  const modelRuntime =
    options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath }));

  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const sessionManager =
    options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

  if (!resourceLoader) {
    resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
    await resourceLoader.reload();
    time("resourceLoader.reload");
  }

  const existingSession = sessionManager.buildSessionContext();
  const hasExistingSession = existingSession.messages.length > 0;
  const hasThinkingEntry = sessionManager
    .getBranch()
    .some((entry) => entry.type === "thinking_level_change");

  let model = options.model;
  let modelFallbackMessage: string | undefined;

  const sessionModel = getBranchSelection(sessionManager.getBranch(), (provider, modelId) =>
    modelRuntime.getModel(provider, modelId),
  );

  if (!model && hasExistingSession && sessionModel) {
    const restoredModel = modelRuntime.getModel(sessionModel.provider, sessionModel.modelId);
    if (restoredModel && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
      model = restoredModel;
    }
    if (!model) {
      modelFallbackMessage = `Could not restore model ${sessionModel.provider}/${sessionModel.modelId}`;
    }
  }

  if (!model) {
    const result = await findInitialModel({
      scopedModels: [],
      isContinuing: hasExistingSession,
      defaultProvider: settingsManager.getDefaultProvider(),
      defaultModelId: settingsManager.getDefaultModel(),
      defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
      modelThinkingLevels: settingsManager.getAllModelThinkingLevels(),
      modelRuntime,
    });
    model = result.model;
    if (!model) {
      modelFallbackMessage = formatNoModelsAvailableMessage();
    } else if (modelFallbackMessage) {
      modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
    }
  }

  let thinkingLevel = options.thinkingLevel;

  if (thinkingLevel === undefined && hasExistingSession) {
    thinkingLevel = hasThinkingEntry
      ? (existingSession.thinkingLevel as ThinkingLevel)
      : (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
  }

  if (thinkingLevel === undefined && model) {
    const perModel = settingsManager.getModelThinkingLevel(model.provider, model.id);
    if (perModel) {
      thinkingLevel = perModel;
    }
  }
  if (thinkingLevel === undefined) {
    thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
  }

  if (!model) {
    thinkingLevel = "off";
  } else {
    thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;
  }

  const toolListError = options.tools ? getToolListError(options.tools) : undefined;
  if (toolListError) throw new Error(`Invalid tools option: ${toolListError}`);
  const defaultToolNames = options.noTools
    ? []
    : (settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES);
  const toolModifiers = options.tools?.some(isToolModifier) ? options.tools : undefined;
  const selectedToolNames = toolModifiers
    ? applyToolModifiers(defaultToolNames, toolModifiers)
    : options.tools;
  const allowedToolNames = toolModifiers
    ? options.noTools === "all"
      ? selectedToolNames
      : undefined
    : (options.tools ?? (options.noTools === "all" ? [] : undefined));
  const excludedToolNames = options.excludeTools;
  const isExcludedTool = excludedToolNames ? createToolNameMatcher(excludedToolNames) : undefined;
  const initialActiveToolNames = (selectedToolNames ?? defaultToolNames).filter(
    (name) => !isExcludedTool?.(name),
  );

  const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
    const converted = convertToLlm(messages);
    if (!settingsManager.getBlockImages()) {
      return converted;
    }
    return converted.map((msg) => {
      if (msg.role === "user" || msg.role === "toolResult") {
        const content = msg.content;
        if (Array.isArray(content)) {
          const hasImages = content.some((c) => c.type === "image");
          if (hasImages) {
            const filteredContent = content
              .map((c) =>
                c.type === "image"
                  ? { type: "text" as const, text: "Image reading is disabled." }
                  : c,
              )
              .filter(
                (c, i, arr) =>
                  !(
                    c.type === "text" &&
                    c.text === "Image reading is disabled." &&
                    i > 0 &&
                    arr[i - 1]?.type === "text" &&
                    (arr[i - 1] as { type: "text"; text: string }).text ===
                      "Image reading is disabled."
                  ),
              );
            return { ...msg, content: filteredContent };
          }
        }
      }
      return msg;
    });
  };

  const extensionRunnerRef: { current?: ExtensionRunner } = {};
  const cacheWarmer = new CacheWarmer(
    modelRuntime,
    sessionManager,
    () => settingsManager.getCacheWarmingMode(),
    async (event) => extensionRunnerRef.current?.emitCacheWarmingDecision(event) ?? event.action,
  );
  const buildRequestOptions = (
    requestModel: Model<any>,
    streamOptions: ModelsSimpleStreamOptions = {},
  ): ModelsSimpleStreamOptions => {
    const providerRetrySettings = settingsManager.getProviderRetrySettings();
    const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
    const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
    const headerRunner = extensionRunnerRef.current;
    return {
      ...streamOptions,
      timeoutMs: streamOptions.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs,
      websocketConnectTimeoutMs:
        streamOptions.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs(),
      maxRetries: streamOptions.maxRetries ?? providerRetrySettings.maxRetries,
      maxRetryDelayMs: streamOptions.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
      transformHeaders: async (requestHeaders) => {
        const headers = mergeProviderAttributionHeaders(
          requestModel,
          settingsManager,
          streamOptions.sessionId,
          requestHeaders,
        );
        return headerRunner?.hasHandlers("before_provider_headers")
          ? headerRunner.emitBeforeProviderHeaders(headers ?? {})
          : (headers ?? {});
      },
    };
  };
  const cacheContextIsCurrent = (requestModel: Model<any>) => {
    const messages = agent.state.messages;
    return () => {
      const currentModel = agent.state.model;
      const currentMessages = agent.state.messages;
      return (
        currentModel.provider === requestModel.provider &&
        currentModel.id === requestModel.id &&
        messages.length <= currentMessages.length &&
        messages.every((message, index) => currentMessages[index] === message)
      );
    };
  };
  const transformProviderPayload = async (payload: unknown) => {
    const runner = extensionRunnerRef.current;
    if (!runner?.hasHandlers("before_provider_request")) return payload;
    return runner.emitBeforeProviderRequest(payload);
  };
  const handleProviderResponse: NonNullable<ModelsSimpleStreamOptions["onResponse"]> = async (
    response,
  ) => {
    const runner = extensionRunnerRef.current;
    if (!runner?.hasHandlers("after_provider_response")) return;
    await runner.emit({
      type: "after_provider_response",
      status: response.status,
      headers: response.headers,
    });
  };
  const handleProviderStreamEvent: NonNullable<
    ModelsSimpleStreamOptions["onProviderStreamEvent"]
  > = async (data, eventModel) => {
    const runner = extensionRunnerRef.current;
    if (!runner?.hasHandlers("provider_stream_event")) return;
    await runner.emit({
      data,
      type: "provider_stream_event",
      provider: eventModel.provider,
      api: eventModel.api,
      model: eventModel.id,
    });
  };

  const thinkingBudgets = settingsManager.getThinkingBudgets();
  const agent = new Agent({
    initialState: {
      systemPrompt: "",
      ...(model ? { model } : {}),
      thinkingLevel,
      tools: [],
      messages: existingSession.messages,
    },
    convertToLlm: convertToLlmWithBlockImages,
    streamFn: async (requestModel, context, streamOptions) => {
      const requestOptions = buildRequestOptions(requestModel, streamOptions);
      if (streamOptions?.sessionId === sessionManager.getSessionId()) {
        cacheWarmer.start(
          { model: requestModel, context, options: requestOptions },
          cacheContextIsCurrent(requestModel),
        );
      }
      return modelRuntime.streamSimple(requestModel, context, requestOptions);
    },
    onPayload: transformProviderPayload,
    onResponse: handleProviderResponse,
    onProviderStreamEvent: handleProviderStreamEvent,
    sessionId: sessionManager.getSessionId(),
    transformContext: async (messages) => {
      const runner = extensionRunnerRef.current;
      if (!runner) return messages;
      return runner.emitContext(messages);
    },
    steeringMode: settingsManager.getSteeringMode(),
    followUpMode: settingsManager.getFollowUpMode(),
    transport: settingsManager.getTransport(),
    ...(thinkingBudgets ? { thinkingBudgets } : {}),
    maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
  });

  if (hasExistingSession) {
    if (!hasThinkingEntry) {
      sessionManager.appendThinkingLevelChange(thinkingLevel);
    }
  } else {
    if (model) {
      sessionManager.appendModelChange(model.provider, model.id);
    }
    sessionManager.appendThinkingLevelChange(thinkingLevel);
  }

  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd,
    scopedModels: options.scopedModels,
    resourceLoader,
    customTools: options.customTools,
    modelRuntime,
    cacheWarmer,
    initialActiveToolNames,
    usesDefaultTools:
      (options.tools === undefined || toolModifiers !== undefined) && !options.noTools,
    defaultToolModifiers: toolModifiers,
    allowedToolNames,
    excludedToolNames,
    extensionRunnerRef,
    sessionStartEvent: options.sessionStartEvent,
    createWorkerSession:
      options.orchestrator && resourceLoader instanceof DefaultResourceLoader
        ? async (worker) => {
            const workerResourceLoader = resourceLoader.fork();
            await workerResourceLoader.reload();
            const workerFlagValues = workerResourceLoader.getExtensions().runtime.flagValues;
            for (const [name, value] of session.extensionRunner.getFlagValues()) {
              workerFlagValues.set(name, value);
            }
            const workerTools = options.tools?.filter(
              (entry) => !isOrchestratorTool(entry.replace(/^[+-]/, "")),
            );
            const { session: workerSession } = await createAgentSession({
              cwd: worker.cwd,
              agentDir,
              modelRuntime,
              settingsManager,
              resourceLoader: workerResourceLoader,
              ...(options.customTools ? { customTools: options.customTools } : {}),
              model: worker.model,
              thinkingLevel: worker.thinkingLevel,
              ...(workerTools && !(workerTools.length === 0 && toolModifiers)
                ? { tools: workerTools }
                : {}),
              excludeTools: [...(options.excludeTools ?? []), ...ORCHESTRATOR_TOOL_NAMES],
              ...(options.noTools ? { noTools: options.noTools } : {}),
              sessionManager: worker.sessionFile
                ? SessionManager.open(worker.sessionFile)
                : SessionManager.create(
                    worker.cwd,
                    join(
                      sessionManager.getSessionDir() || getDefaultSessionDir(worker.cwd, agentDir),
                      "workers",
                    ),
                  ),
            });
            await workerSession.bindExtensions({ mode: "print" });
            return workerSession;
          }
        : undefined,
  });

  const extensionsResult = resourceLoader.getExtensions();

  return {
    session,
    extensionsResult,
    modelFallbackMessage,
  };
}
