import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type sdkTypes from "../sdk.types.ts";
import createAgentModule from "./create-agent.ts";
import runtimeParts from "./runtime-parts.ts";
import sessionAssembly from "./session-assembly.ts";
import sessionStart from "./session-start.ts";
import thinkingLevelModule from "./thinking-level.ts";
import toolSelection from "./tool-selection.ts";

const { awaiting } = awaitingModule;
const { createAgent } = createAgentModule;
const { createRuntimeParts } = runtimeParts;
const { assembleSession } = sessionAssembly;
const { prepareSessionStart } = sessionStart;
const { initialThinkingLevel } = thinkingLevelModule;
const { selectTools } = toolSelection;

function* createSessionSteps(options: sdkTypes.CreateAgentSessionOptions) {
  const runtime = yield* createRuntimeParts(options);
  const { modelRuntime, sessionManager, settingsManager } = runtime;
  const start = yield* prepareSessionStart(runtime, options.resourceLoader);
  const { model, hasExistingSession, hasThinkingEntry, resourceLoader } = start;
  const thinkingLevel = initialThinkingLevel({
    hasExistingSession,
    model,
    requested: options.thinkingLevel,
    sessionThinkingLevel: hasThinkingEntry ? start.existingSession.thinkingLevel : undefined,
    settingsManager,
  });
  const tools = selectTools(options, settingsManager);
  const extensionRunnerRef: { current?: extensionsTypes.ExtensionRunner } = {};
  const created = createAgent({
    extensionRunnerRef,
    messages: start.existingSession.messages,
    model,
    modelRuntime,
    sessionManager,
    settingsManager,
    thinkingLevel,
  });
  if (!hasExistingSession && model !== undefined) {
    sessionManager.appendModelChange(model.provider, model.id);
  }
  if (!hasExistingSession || !hasThinkingEntry) {
    sessionManager.appendThinkingLevelChange(thinkingLevel);
  }
  const session = assembleSession({
    createAgentSession,
    created,
    extensionRunnerRef,
    resourceLoader,
    runtime,
    tools,
  });
  return {
    extensionsResult: resourceLoader.getExtensions(),
    modelFallbackMessage: start.modelFallbackMessage,
    session,
  };
}

function createAgentSession(
  options: sdkTypes.CreateAgentSessionOptions = {},
): Promise<sdkTypes.CreateAgentSessionResult> {
  return Effect.runPromise(awaiting(() => createSessionSteps(options)));
}

const createAgentSessionModule = { createAgentSession };

export default createAgentSessionModule;
