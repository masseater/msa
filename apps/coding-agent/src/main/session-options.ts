import ai from "@msa/ai";

import type argsTypes from "../cli/args.types.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import cliModelFlag from "../core/cli-model.ts";
import type modelResolverTypes from "../core/model-resolver.types.ts";
import ModelRuntime from "../core/model-runtime.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import type sdkTypes from "../core/sdk.types.ts";
import SettingsManager from "../core/settings-manager.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";

const { modelsAreEqual } = ai;
const { resolveCliModel } = cliModelFlag;

function buildSessionOptions(
  parsed: argsTypes.Args,
  scopedModels: modelResolverTypes.ScopedModel[],
  hasExistingSession: boolean,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  settingsManager: settingsManagerTypes.SettingsManager,
): {
  options: sdkTypes.CreateAgentSessionOptions;
  cliThinkingFromModel: boolean;
  diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];
} {
  let { diagnostics, options, cliThinkingFromModel }: ReturnType<typeof cliModelOptions> =
    cliModelOptions(parsed);
  if (parsed.model !== undefined && parsed.model !== "") {
    const resolved = resolveCliModel({
      cliModel: parsed.model,
      cliProvider: parsed.provider,
      cliThinking: parsed.thinking,
      inlineApiKey: Boolean(parsed.apiKey),
      modelRuntime,
    });
    if (resolved.warning !== undefined && resolved.warning !== "") {
      diagnostics.push({ message: resolved.warning, type: "warning" });
    }
    if (resolved.error !== undefined && resolved.error !== "") {
      diagnostics.push({ message: resolved.error, type: "error" });
    }
    if (resolved.model !== undefined) {
      options.model = resolved.model;

      if (parsed.thinking === undefined && resolved.thinkingLevel !== undefined) {
        options.thinkingLevel = resolved.thinkingLevel;
        cliThinkingFromModel = true;
      }
    }
  }

  const firstScopedModel = scopedModels[0];
  return completeSessionOptions(
    options,
    firstScopedModel,
    hasExistingSession,
    settingsManager,
    modelRuntime,
    scopedModels,
    parsed,
    cliThinkingFromModel,
    diagnostics,
  );
}

function applyScopedModelDefault(
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

  applyThinkingAndScope(parsed, options, scopedModels);

  if (parsed.noTools === true) {
    options.noTools = "all";
  } else if (parsed.noBuiltinTools === true) {
    options.noTools = "builtin";
  }
}

function applyThinkingAndScope(
  parsed: argsTypes.Args,
  options: sdkTypes.CreateAgentSessionOptions,
  scopedModels: modelResolverTypes.ScopedModel[],
) {
  if (parsed.thinking !== undefined) {
    options.thinkingLevel = parsed.thinking;
  }

  if (scopedModels.length > 0) {
    options.scopedModels = scopedModels.map((sm) => ({
      model: sm.model,
      thinkingLevel: sm.thinkingLevel,
    }));
  }
}

function cliModelOptions(parsed: argsTypes.Args) {
  const options: sdkTypes.CreateAgentSessionOptions = {};
  const diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [];
  let cliThinkingFromModel = false;

  if (
    parsed.provider !== undefined &&
    parsed.provider !== "" &&
    (parsed.model === undefined || parsed.model === "")
  ) {
    diagnostics.push({
      message: `--provider requires --model (for example: --provider ${parsed.provider} --model <pattern>)`,
      type: "error",
    });
  }
  return { cliThinkingFromModel, diagnostics, options };
}

function completeSessionOptions(
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
  applyScopedModelDefault(
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

const sessionOptionsModule = { buildSessionOptions };

export default sessionOptionsModule;
