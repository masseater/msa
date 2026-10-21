import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import paths from "../utils/paths.ts";
import AgentSession from "./agent-session.ts";
import awaitingModule from "./awaiting.ts";
import CacheWarmer from "./cache-warmer.ts";
import DefaultResourceLoader from "./default-resource-loader.ts";
import defaults from "./defaults.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import ModelRuntime from "./model-runtime.ts";
import toolNames from "./orchestrator/tool-names.ts";
import platformNode from "./platform-node.ts";
import providerAttribution from "./provider-attribution.ts";
import sdkPart1 from "./sdk-part1.ts";
import sdkPart2 from "./sdk-part2.ts";
import sdkPart3 from "./sdk-part3.ts";
import type sdkTypes from "./sdk.types.ts";
import SessionManager from "./session-manager.ts";
import sessionFiles from "./session-manager/session-files.ts";
import settingsManagerSupport from "./settings-manager-support.ts";
import SettingsManager from "./settings-manager.ts";

const { awaited, awaiting } = awaitingModule;
const { resolvePath } = paths;
const { getDefaultAgentDir } = sdkPart1;
const { join } = platformNode;
const { getDefaultSessionDir } = sessionFiles;
const { createAgentSessionPart2 } = sdkPart2;
const { DEFAULT_THINKING_LEVEL } = defaults;
const { clampThinkingLevel } = compat;
const { DEFAULT_TOOL_NAMES, applyToolModifiers, getToolListError, isToolModifier } =
  settingsManagerSupport;
const { createAgentSessionPart1 } = sdkPart3;
const { mergeProviderAttributionHeaders } = providerAttribution;
const { Agent } = agentModule;
const { ORCHESTRATOR_TOOL_NAMES, isOrchestratorTool } = toolNames;

function createAgentSession(
  options: sdkTypes.CreateAgentSessionOptions = {},
): Promise<sdkTypes.CreateAgentSessionResult> {
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
      modelRuntime.setModelPolicy(settingsManager.models.getModelPolicy());
      const sessionManager =
        options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

      let hasExistingSession;
      let hasThinkingEntry;
      let existingSession;
      let model;
      let modelFallbackMessage: string | undefined;
      ({
        hasExistingSession,
        hasThinkingEntry,
        existingSession,
        model,
        modelFallbackMessage,
        resourceLoader,
      } = yield* createAgentSessionPart2(
        resourceLoader,
        agentDir,
        cwd,
        settingsManager,
        sessionManager,
        options,
        modelRuntime,
      ));

      let thinkingLevel = options.thinkingLevel;

      if (thinkingLevel === undefined && hasExistingSession) {
        thinkingLevel = hasThinkingEntry
          ? (existingSession.thinkingLevel as agentTypes.ThinkingLevel)
          : (settingsManager.models.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
      }

      if (thinkingLevel === undefined && model !== undefined) {
        const perModel = settingsManager.models.getModelThinkingLevel(model.provider, model.id);
        if (perModel !== undefined) {
          thinkingLevel = perModel;
        }
      }
      if (thinkingLevel === undefined) {
        thinkingLevel = settingsManager.models.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
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
          ? (settingsManager.resources.getDefaultTools() ?? DEFAULT_TOOL_NAMES)
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
      const { convertToLlmWithBlockImages, excludedToolNames, initialActiveToolNames } =
        createAgentSessionPart1(options, selectedToolNames, defaultToolNames, settingsManager);

      const extensionRunnerRef: { current?: extensionsTypes.ExtensionRunner } = {};
      const cacheWarmer = new CacheWarmer(
        modelRuntime,
        sessionManager,
        () => settingsManager.session.getCacheWarmingMode(),
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
        const providerRetrySettings = settingsManager.session.getProviderRetrySettings();
        const httpIdleTimeoutMs = settingsManager.session.getHttpIdleTimeoutMs();
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
            settingsManager.session.getWebSocketConnectTimeoutMs(),
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

      const thinkingBudgets = settingsManager.models.getThinkingBudgets();
      const agent = new Agent({
        convertToLlm: convertToLlmWithBlockImages,
        followUpMode: settingsManager.session.getFollowUpMode(),
        initialState: {
          systemPrompt: "",
          ...(model === undefined ? {} : { model }),
          messages: existingSession.messages,
          thinkingLevel,
          tools: [],
        },
        onPayload: transformProviderPayload,
        onProviderStreamEvent: handleProviderStreamEvent,
        onResponse: handleProviderResponse,
        sessionId: sessionManager.getSessionId(),
        steeringMode: settingsManager.session.getSteeringMode(),
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
        transformContext: (messages) =>
          Effect.runPromise(
            awaiting(function* () {
              const runner = extensionRunnerRef.current;
              if (runner === undefined) return messages;
              return yield* awaited(runner.emitContext(messages));
            }),
          ),
        transport: settingsManager.models.getTransport(),
        ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }),
        maxRetryDelayMs: settingsManager.session.getProviderRetrySettings().maxRetryDelayMs,
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
                    for (const [
                      name,
                      value,
                    ] of session.extensions.binding.extensionRunner.getFlagValues()) {
                      workerFlagValues.set(name, value);
                    }
                    const workerTools = options.tools?.filter(
                      (entry) => !isOrchestratorTool(entry.replace(/^[+-]/u, "")),
                    );
                    const { session: workerSession } = yield* awaited(
                      createAgentSession({
                        agentDir,
                        cwd: worker.cwd,
                        modelRuntime,
                        resourceLoader: workerResourceLoader,
                        settingsManager,
                        ...(options.customTools === undefined
                          ? {}
                          : { customTools: options.customTools }),
                        isWorker: true,
                        model: worker.model,
                        telemetry: worker.telemetry,
                        thinkingLevel: worker.thinkingLevel,
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
                    yield* awaited(
                      workerSession.extensions.binding.bindExtensions({ mode: "print" }),
                    );
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

const sdkPart4Part1 = {
  createAgentSession,
};

export default sdkPart4Part1;
