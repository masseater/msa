import authGuidance from "./auth-guidance.ts";
import awaitingModule from "./awaiting.ts";
import DefaultResourceLoader from "./default-resource-loader.ts";
import initialModel from "./initial-model.ts";
import ModelRuntime from "./model-runtime.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import type sdkTypes from "./sdk.types.ts";
import SessionManager from "./session-manager.ts";
import SettingsManager from "./settings-manager.ts";
import timings from "./timings.ts";
import virtualModels from "./virtual-models.ts";

const { awaited } = awaitingModule;
const { time } = timings;
const { getBranchSelection } = virtualModels;
const { findInitialModel } = initialModel;
const { formatNoModelsAvailableMessage } = authGuidance;

function* createAgentSessionPart2(
  resourceLoader: resourceLoaderTypes.ResourceLoader | undefined,
  agentDir: string,
  cwd: string,
  settingsManager: SettingsManager,
  sessionManager: SessionManager,
  options: sdkTypes.CreateAgentSessionOptions,
  modelRuntime: ModelRuntime,
) {
  let model;
  let hasExistingSession;
  let modelFallbackMessage: string | undefined;
  let existingSession;
  let hasThinkingEntry;
  ({
    model,
    hasExistingSession,
    modelFallbackMessage,
    existingSession,
    hasThinkingEntry,
    resourceLoader,
  } = yield* createAgentSessionPart2Part1(
    resourceLoader,
    agentDir,
    cwd,
    settingsManager,
    sessionManager,
    options,
    modelRuntime,
  ));

  if (model === undefined) {
    const result = yield* awaited(
      findInitialModel({
        defaultModelId: settingsManager.models.getDefaultModel(),
        defaultProvider: settingsManager.models.getDefaultProvider(),
        defaultThinkingLevel: settingsManager.models.getDefaultThinkingLevel(),
        isContinuing: hasExistingSession,
        modelRuntime,
        modelThinkingLevels: settingsManager.models.getAllModelThinkingLevels(),
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
  return {
    existingSession,
    hasExistingSession,
    hasThinkingEntry,
    model,
    modelFallbackMessage,
    resourceLoader,
  };
}

const sdkPart2 = {
  createAgentSessionPart2,
};

export default sdkPart2;

function* createAgentSessionPart2Part1(
  resourceLoader: resourceLoaderTypes.ResourceLoader | undefined,
  agentDir: string,
  cwd: string,
  settingsManager: SettingsManager,
  sessionManager: SessionManager,
  options: sdkTypes.CreateAgentSessionOptions,
  modelRuntime: ModelRuntime,
) {
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
  return {
    existingSession,
    hasExistingSession,
    hasThinkingEntry,
    model,
    modelFallbackMessage,
    resourceLoader,
  };
}
