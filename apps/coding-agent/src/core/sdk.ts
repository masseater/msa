import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AgentSession } from "./agent-session.ts";
import { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
import { awaited, awaiting } from "./awaiting.ts";
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
import type { SessionTelemetryOptions } from "./observability/session-telemetry.ts";
import { ORCHESTRATOR_TOOL_NAMES, isOrchestratorTool } from "./orchestrator/tool-names.ts";
import { join } from "./platform-node.ts";
import { mergeProviderAttributionHeaders } from "./provider-attribution.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { DefaultResourceLoader } from "./resource-loader.ts";
import { SessionManager, getDefaultSessionDir } from "./session-manager.ts";
import {
  DEFAULT_TOOL_NAMES,
  SettingsManager,
  applyToolModifiers,
  getToolListError,
  isToolModifier,
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

const { clampThinkingLevel, streamSimple } = compat;

const { Agent, setDefaultStreamFn } = agentModule;

setDefaultStreamFn(streamSimple);

export interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;

  modelRuntime?: ModelRuntime;

  model?: compatTypes.Model<any> | undefined;
  thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  scopedModels?:
    | Array<{ model: compatTypes.Model<any>; thinkingLevel?: agentTypes.ThinkingLevel | undefined }>
    | undefined;

  noTools?: "all" | "builtin" | undefined;
  tools?: string[] | undefined;
  excludeTools?: string[] | undefined;
  customTools?: ToolDefinition[] | undefined;

  resourceLoader?: ResourceLoader;

  sessionManager?: SessionManager;

  settingsManager?: SettingsManager;
  sessionStartEvent?: SessionStartEvent | undefined;
  isWorker?: boolean | undefined;
  telemetry?: SessionTelemetryOptions | undefined;
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
};

function getDefaultAgentDir(): string {
  return getAgentDir();
}

export function createAgentSession(
  options: CreateAgentSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
      const agentDir =
        options.agentDir !== undefined && options.agentDir !== ""
          ? resolvePath(options.agentDir)
          : getDefaultAgentDir();
      let resourceLoader = options.resourceLoader;

      const authPath =
        options.agentDir !== undefined && options.agentDir !== ""
          ? join(agentDir, "auth.json")
          : undefined;
      const modelsPath =
        options.agentDir !== undefined && options.agentDir !== ""
          ? join(agentDir, "models.json")
          : undefined;
      const modelRuntime =
        options.modelRuntime ?? (yield* awaited(ModelRuntime.create({ authPath, modelsPath })));

      const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
      modelRuntime.setModelPolicy(settingsManager.getModelPolicy());
      const sessionManager =
        options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

      if (resourceLoader === undefined) {
        resourceLoader = new DefaultResourceLoader({ agentDir, cwd, settingsManager });
        yield* awaited(resourceLoader.reload());
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

      if (model === undefined && hasExistingSession && sessionModel !== undefined) {
        const restoredModel = modelRuntime.getModel(sessionModel.provider, sessionModel.modelId);
        if (restoredModel !== undefined && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
          model = restoredModel;
        }
        if (model === undefined) {
          modelFallbackMessage = `Could not restore model ${sessionModel.provider}/${sessionModel.modelId}`;
        }
      }

      if (model === undefined) {
        const result = yield* awaited(
          findInitialModel({
            defaultModelId: settingsManager.getDefaultModel(),
            defaultProvider: settingsManager.getDefaultProvider(),
            defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
            isContinuing: hasExistingSession,
            modelRuntime,
            modelThinkingLevels: settingsManager.getAllModelThinkingLevels(),
            scopedModels: [],
          }),
        );
        model = result.model;
        if (model === undefined) {
          modelFallbackMessage = formatNoModelsAvailableMessage();
        } else if (modelFallbackMessage !== undefined && modelFallbackMessage !== "") {
          modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
        }
      }

      let thinkingLevel = options.thinkingLevel;

      if (thinkingLevel === undefined && hasExistingSession) {
        thinkingLevel = hasThinkingEntry
          ? (existingSession.thinkingLevel as agentTypes.ThinkingLevel)
          : (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
      }

      if (thinkingLevel === undefined && model !== undefined) {
        const perModel = settingsManager.getModelThinkingLevel(model.provider, model.id);
        if (perModel !== undefined) {
          thinkingLevel = perModel;
        }
      }
      if (thinkingLevel === undefined) {
        thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
      }

      if (model === undefined) {
        thinkingLevel = "off";
      } else {
        thinkingLevel = clampThinkingLevel(model, thinkingLevel) as agentTypes.ThinkingLevel;
      }

      const toolListError =
        options.tools === undefined ? undefined : getToolListError(options.tools);
      if (toolListError !== undefined && toolListError !== "")
        throw new Error(`Invalid tools option: ${toolListError}`);
      const defaultToolNames =
        options.noTools === undefined
          ? (settingsManager.getDefaultTools() ?? DEFAULT_TOOL_NAMES)
          : [];
      const toolModifiers =
        options.tools?.some(isToolModifier) === true ? options.tools : undefined;
      const selectedToolNames =
        toolModifiers === undefined
          ? options.tools
          : applyToolModifiers(defaultToolNames, toolModifiers);
      const allowedToolNames =
        toolModifiers === undefined
          ? (options.tools ?? (options.noTools === "all" ? [] : undefined))
          : options.noTools === "all"
            ? selectedToolNames
            : undefined;
      const excludedToolNames = options.excludeTools;
      const isExcludedTool =
        excludedToolNames === undefined ? undefined : createToolNameMatcher(excludedToolNames);
      const initialActiveToolNames = (selectedToolNames ?? defaultToolNames).filter(
        (name) => isExcludedTool?.(name) !== true,
      );

      const convertToLlmWithBlockImages = (
        messages: agentTypes.AgentMessage[],
      ): compatTypes.Message[] => {
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
                      ? { text: "Image reading is disabled.", type: "text" as const }
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
                return Object.assign({}, msg, { content: filteredContent });
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
        (event) =>
          Effect.runPromise(
            awaiting(function* () {
              return yield* awaited(
                extensionRunnerRef.current?.emitCacheWarmingDecision(event) ?? event.action,
              );
            }),
          ),
      );
      const buildRequestOptions = (
        requestModel: compatTypes.Model<any>,
        streamOptions: aiTypes.ModelsSimpleStreamOptions = {},
      ): aiTypes.ModelsSimpleStreamOptions => {
        const providerRetrySettings = settingsManager.getProviderRetrySettings();
        const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
        const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
        const headerRunner = extensionRunnerRef.current;
        return {
          ...streamOptions,
          maxRetries: streamOptions.maxRetries ?? providerRetrySettings.maxRetries,
          maxRetryDelayMs: streamOptions.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
          timeoutMs:
            streamOptions.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs,
          transformHeaders: (requestHeaders) =>
            Effect.runPromise(
              awaiting(function* () {
                const headers = mergeProviderAttributionHeaders(
                  requestModel,
                  settingsManager,
                  streamOptions.sessionId,
                  requestHeaders,
                );
                return yield* awaited(
                  headerRunner?.hasHandlers("before_provider_headers") === true
                    ? headerRunner.emitBeforeProviderHeaders(headers ?? {})
                    : (headers ?? {}),
                );
              }),
            ),
          websocketConnectTimeoutMs:
            streamOptions.websocketConnectTimeoutMs ??
            settingsManager.getWebSocketConnectTimeoutMs(),
        };
      };
      const cacheContextIsCurrent = (requestModel: compatTypes.Model<any>) => {
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
      const transformProviderPayload = (payload: unknown) =>
        Effect.runPromise(
          awaiting(function* () {
            const runner = extensionRunnerRef.current;
            if (runner?.hasHandlers("before_provider_request") !== true) return payload;
            return yield* awaited(runner.emitBeforeProviderRequest(payload));
          }),
        );
      const handleProviderResponse: NonNullable<aiTypes.ModelsSimpleStreamOptions["onResponse"]> = (
        response,
      ) =>
        Effect.runPromise(
          awaiting(function* () {
            const runner = extensionRunnerRef.current;
            if (runner?.hasHandlers("after_provider_response") !== true) return;
            yield* awaited(
              runner.emit({
                headers: response.headers,
                status: response.status,
                type: "after_provider_response",
              }),
            );
          }),
        );
      const handleProviderStreamEvent: NonNullable<
        aiTypes.ModelsSimpleStreamOptions["onProviderStreamEvent"]
      > = (data, eventModel) =>
        Effect.runPromise(
          awaiting(function* () {
            const runner = extensionRunnerRef.current;
            if (runner?.hasHandlers("provider_stream_event") !== true) return;
            yield* awaited(
              runner.emit({
                api: eventModel.api,
                data,
                model: eventModel.id,
                provider: eventModel.provider,
                type: "provider_stream_event",
              }),
            );
          }),
        );

      const thinkingBudgets = settingsManager.getThinkingBudgets();
      const agent = new Agent({
        initialState: {
          systemPrompt: "",
          ...(model === undefined ? {} : { model }),
          thinkingLevel,
          tools: [],
          messages: existingSession.messages,
        },
        convertToLlm: convertToLlmWithBlockImages,
        streamFn: (requestModel, context, streamOptions) =>
          Effect.runPromise(
            Effect.sync(() => {
              const requestOptions = buildRequestOptions(requestModel, streamOptions);
              if (streamOptions?.sessionId === sessionManager.getSessionId()) {
                cacheWarmer.start(
                  { context, model: requestModel, options: requestOptions },
                  cacheContextIsCurrent(requestModel),
                );
              }
              return modelRuntime.streamSimple(requestModel, context, requestOptions);
            }),
          ),
        onPayload: transformProviderPayload,
        onResponse: handleProviderResponse,
        onProviderStreamEvent: handleProviderStreamEvent,
        sessionId: sessionManager.getSessionId(),
        transformContext: (messages) =>
          Effect.runPromise(
            awaiting(function* () {
              const runner = extensionRunnerRef.current;
              if (runner === undefined) return messages;
              return yield* awaited(runner.emitContext(messages));
            }),
          ),
        steeringMode: settingsManager.getSteeringMode(),
        followUpMode: settingsManager.getFollowUpMode(),
        transport: settingsManager.getTransport(),
        ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }),
        maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
      });

      if (hasExistingSession) {
        if (!hasThinkingEntry) {
          sessionManager.appendThinkingLevelChange(thinkingLevel);
        }
      } else {
        if (model !== undefined) {
          sessionManager.appendModelChange(model.provider, model.id);
        }
        sessionManager.appendThinkingLevelChange(thinkingLevel);
      }

      const session = new AgentSession({
        agent,
        allowedToolNames,
        cacheWarmer,
        createWorkerSession:
          options.isWorker !== true && resourceLoader instanceof DefaultResourceLoader
            ? (worker) =>
                Effect.runPromise(
                  awaiting(function* () {
                    const workerResourceLoader = resourceLoader.fork();
                    yield* awaited(workerResourceLoader.reload());
                    const workerFlagValues =
                      workerResourceLoader.getExtensions().runtime.flagValues;
                    for (const [name, value] of session.extensionRunner.getFlagValues()) {
                      workerFlagValues.set(name, value);
                    }
                    const workerTools = options.tools?.filter(
                      (entry) => !isOrchestratorTool(entry.replace(/^[+-]/u, "")),
                    );
                    const { session: workerSession } = yield* awaited(
                      createAgentSession({
                        cwd: worker.cwd,
                        agentDir,
                        modelRuntime,
                        settingsManager,
                        resourceLoader: workerResourceLoader,
                        ...(options.customTools === undefined
                          ? {}
                          : { customTools: options.customTools }),
                        model: worker.model,
                        thinkingLevel: worker.thinkingLevel,
                        isWorker: true,
                        telemetry: worker.telemetry,
                        ...(workerTools !== undefined &&
                        !(workerTools.length === 0 && toolModifiers !== undefined)
                          ? { tools: workerTools }
                          : {}),
                        excludeTools: [...(options.excludeTools ?? []), ...ORCHESTRATOR_TOOL_NAMES],
                        ...(options.noTools === undefined ? {} : { noTools: options.noTools }),
                        sessionManager:
                          worker.sessionFile !== undefined && worker.sessionFile !== ""
                            ? SessionManager.open(worker.sessionFile)
                            : SessionManager.create(
                                worker.cwd,
                                join(
                                  sessionManager.getSessionDir() ||
                                    getDefaultSessionDir(worker.cwd, agentDir),
                                  "workers",
                                ),
                              ),
                      }),
                    );
                    yield* awaited(workerSession.bindExtensions({ mode: "print" }));
                    return workerSession;
                  }),
                )
            : undefined,
        customTools: options.customTools,
        cwd,
        defaultToolModifiers: toolModifiers,
        excludedToolNames,
        extensionRunnerRef,
        initialActiveToolNames,
        modelRuntime,
        resourceLoader,
        scopedModels: options.scopedModels,
        sessionManager,
        sessionStartEvent: options.sessionStartEvent,
        settingsManager,
        telemetry: options.telemetry,
        usesDefaultTools:
          (options.tools === undefined || toolModifiers !== undefined) &&
          options.noTools === undefined,
      });

      const extensionsResult = resourceLoader.getExtensions();

      return {
        extensionsResult,
        modelFallbackMessage,
        session,
      };
    }),
  );
}
