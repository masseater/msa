import agentModule from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import CacheWarmer from "../cache-warmer.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import llmConversion from "./llm-conversion.ts";
import ProviderHooks from "./provider-hooks.ts";
import type sdkInternalTypes from "./sdk-internal.types.ts";

const { Agent } = agentModule;
const { awaited, awaiting } = awaitingModule;
const { convertToLlmFor } = llmConversion;

type AgentSetup = Pick<
  sdkInternalTypes.SdkRuntime,
  "modelRuntime" | "sessionManager" | "settingsManager"
> & {
  extensionRunnerRef: { current?: extensionsTypes.ExtensionRunner };
  model: compatTypes.Model<any> | undefined;
  messages: agentTypes.AgentMessage[];
  thinkingLevel: agentTypes.ThinkingLevel;
};

const createCacheWarmer = (setup: AgentSetup): CacheWarmer => {
  const { modelRuntime, sessionManager, settingsManager, extensionRunnerRef } = setup;
  return new CacheWarmer(
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
};

const contextIsCurrent = (
  agent: agentTypes.Agent,
  requestModel: compatTypes.Model<any>,
): (() => boolean) => {
  const messages = agent.state.messages;
  return (): boolean => {
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

function createAgent(setup: AgentSetup): { agent: agentTypes.Agent; cacheWarmer: CacheWarmer } {
  const { modelRuntime, sessionManager, settingsManager, model, thinkingLevel } = setup;
  const cacheWarmer = createCacheWarmer(setup);
  const hooks = new ProviderHooks(settingsManager, setup.extensionRunnerRef);
  const thinkingBudgets = settingsManager.models.getThinkingBudgets();
  const agent: agentTypes.Agent = new Agent({
    convertToLlm: convertToLlmFor(settingsManager),
    followUpMode: settingsManager.session.getFollowUpMode(),
    initialState: {
      systemPrompt: "",
      ...(model === undefined ? {} : { model }),
      messages: setup.messages,
      thinkingLevel,
      tools: [],
    },
    onPayload: (payload) => hooks.transformPayload(payload),
    onProviderStreamEvent: hooks.handleStreamEvent,
    onResponse: hooks.handleResponse,
    sessionId: sessionManager.getSessionId(),
    steeringMode: settingsManager.session.getSteeringMode(),
    streamFn: (requestModel, context, streamOptions) =>
      Effect.runPromise(
        Effect.sync(() => {
          const requestOptions = hooks.requestOptions(requestModel, streamOptions);
          if (streamOptions?.sessionId === sessionManager.getSessionId()) {
            cacheWarmer.start(
              { context, model: requestModel, options: requestOptions },
              contextIsCurrent(agent, requestModel),
            );
          }
          return modelRuntime.streamSimple(requestModel, context, requestOptions);
        }),
      ),
    transformContext: (messages) => hooks.transformContext(messages),
    transport: settingsManager.models.getTransport(),
    ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }),
    maxRetryDelayMs: settingsManager.session.getProviderRetrySettings().maxRetryDelayMs,
  });
  return { agent, cacheWarmer };
}

const createAgentModule = { createAgent };

export default createAgentModule;
