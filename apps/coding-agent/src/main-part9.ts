import ai from "@msa/ai";

import type argsTypes from "./cli/args.types.ts";
import type agentSessionServicesTypes from "./core/agent-session-services.types.ts";
import type modelResolverTypes from "./core/model-resolver.types.ts";
import ModelRuntime from "./core/model-runtime.ts";
import type sdkTypes from "./core/sdk.types.ts";
import SettingsManager from "./core/settings-manager.ts";
import mainPart8 from "./main-part8.ts";

const { modelsAreEqual } = ai;
const { buildSessionOptionsPart1Part1 } = mainPart8;

function buildSessionOptionsPart3(
  options: sdkTypes.CreateAgentSessionOptions,
  firstScopedModel: modelResolverTypes.ScopedModel | undefined,
  hasExistingSession: boolean,
  settingsManager: SettingsManager,
  modelRuntime: ModelRuntime,
  scopedModels: modelResolverTypes.ScopedModel[],
  parsed: argsTypes.Args,
  cliThinkingFromModel: boolean,
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[],
): {
  options: sdkTypes.CreateAgentSessionOptions;
  cliThinkingFromModel: boolean;
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];
} {
  buildSessionOptionsPart1(
    options,
    firstScopedModel,
    hasExistingSession,
    settingsManager,
    modelRuntime,
    scopedModels,
    parsed,
  );
  if (parsed.tools !== undefined) {
    options.tools = [...parsed.tools];
  }
  if (parsed.excludeTools !== undefined) {
    options.excludeTools = [...parsed.excludeTools];
  }

  return { cliThinkingFromModel, diagnostics, options };
}

function buildSessionOptionsPart1(
  options: sdkTypes.CreateAgentSessionOptions,
  firstScopedModel: modelResolverTypes.ScopedModel | undefined,
  hasExistingSession: boolean,
  settingsManager: SettingsManager,
  modelRuntime: ModelRuntime,
  scopedModels: modelResolverTypes.ScopedModel[],
  parsed: argsTypes.Args,
) {
  if (options.model === undefined && firstScopedModel !== undefined && !hasExistingSession) {
    const savedProvider = settingsManager.models.getDefaultProvider();
    const savedModelId = settingsManager.models.getDefaultModel();
    const savedModel =
      savedProvider !== undefined &&
      savedProvider !== "" &&
      savedModelId !== undefined &&
      savedModelId !== ""
        ? modelRuntime.getModel(savedProvider, savedModelId)
        : undefined;
    const savedInScope =
      savedModel === undefined
        ? undefined
        : scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel));

    if (savedInScope === undefined) {
      options.model = firstScopedModel.model;

      if (parsed.thinking === undefined && firstScopedModel.thinkingLevel !== undefined) {
        options.thinkingLevel = firstScopedModel.thinkingLevel;
      }
    } else {
      options.model = savedInScope.model;

      if (parsed.thinking === undefined && savedInScope.thinkingLevel !== undefined) {
        options.thinkingLevel = savedInScope.thinkingLevel;
      }
    }
  }

  buildSessionOptionsPart1Part1(parsed, options, scopedModels);

  if (parsed.noTools === true) {
    options.noTools = "all";
  } else if (parsed.noBuiltinTools === true) {
    options.noTools = "builtin";
  }
}

const mainPart9 = {
  buildSessionOptionsPart3,
};

export default mainPart9;
