import authGuidance from "../auth-guidance.ts";
import awaitingModule from "../awaiting.ts";
import DefaultResourceLoader from "../default-resource-loader.ts";
import initialModel from "../initial-model.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import timings from "../timings.ts";
import virtualModels from "../virtual-models.ts";
import type sdkInternalTypes from "./sdk-internal.types.ts";

const { awaited } = awaitingModule;
const { time } = timings;
const { getBranchSelection } = virtualModels;
const { findInitialModel } = initialModel;
const { formatNoModelsAvailableMessage } = authGuidance;

type StartContext = sdkInternalTypes.SdkRuntime;

const restoreSessionModel = (
  context: StartContext,
  hasExistingSession: boolean,
): { model: sdkInternalTypes.Options["model"]; fallbackMessage: string | undefined } => {
  const { options, modelRuntime, sessionManager } = context;
  const sessionModel = getBranchSelection(sessionManager.getBranch(), (provider, modelId) =>
    modelRuntime.getModel(provider, modelId),
  );
  if (options.model !== undefined || !hasExistingSession || sessionModel === undefined) {
    return { fallbackMessage: undefined, model: options.model };
  }
  const restoredModel = modelRuntime.getModel(sessionModel.provider, sessionModel.modelId);
  if (restoredModel !== undefined && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
    return { fallbackMessage: undefined, model: restoredModel };
  }
  return {
    fallbackMessage: `Could not restore model ${sessionModel.provider}/${sessionModel.modelId}`,
    model: undefined,
  };
};

function* prepareSessionStart(
  context: StartContext,
  initialResourceLoader: resourceLoaderTypes.ResourceLoader | undefined,
) {
  const { agentDir, cwd, settingsManager, sessionManager, modelRuntime } = context;
  let resourceLoader = initialResourceLoader;
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
  let { model, fallbackMessage: modelFallbackMessage } = restoreSessionModel(
    context,
    hasExistingSession,
  );
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

const sessionStart = { prepareSessionStart };

export default sessionStart;
