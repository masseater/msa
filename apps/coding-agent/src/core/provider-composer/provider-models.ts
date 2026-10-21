import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type modelConfigTypes from "../model-config.types.ts";
import type providerComposerTypes from "../provider-composer.types.ts";
import modelOverrides from "./model-overrides.ts";

const { isModelType } = ai;
const { mergeCompat } = modelOverrides;

function getAllProviderModels(provider: aiTypes.Provider | undefined): readonly aiTypes.AnyModel[] {
  return provider === undefined ? [] : (provider.getAllModels?.() ?? provider.getModels());
}

function modelFromJson(
  providerId: string,
  definition: modelConfigTypes.ModelsJsonModel,
  providerConfig: modelConfigTypes.ModelsJsonProvider,
  defaults: aiTypes.Model<aiTypes.Api> | undefined,
): aiTypes.Model<aiTypes.Api> {
  const api = definition.api ?? providerConfig.api ?? defaults?.api;
  if (api === undefined || api === "") {
    throw new Error(
      `Provider ${providerId}, model ${definition.id}: no "api" specified. Set at provider or model level.`,
    );
  }
  const baseUrl = definition.baseUrl ?? providerConfig.baseUrl ?? defaults?.baseUrl;
  if (baseUrl === undefined || baseUrl === "")
    throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
  if (definition.contextWindow !== undefined && definition.contextWindow <= 0) {
    throw new Error(`Provider ${providerId}, model ${definition.id}: invalid contextWindow`);
  }
  if (definition.maxTokens !== undefined && definition.maxTokens <= 0) {
    throw new Error(`Provider ${providerId}, model ${definition.id}: invalid maxTokens`);
  }
  const compat = mergeCompat(providerConfig.compat, definition.compat);
  return {
    api: api as aiTypes.Api,
    baseUrl,
    id: definition.id,
    name: definition.name ?? definition.id,
    provider: providerId,
    reasoning: definition.reasoning ?? false,
    ...(definition.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: definition.thinkingLevelMap }),
    input: (definition.input ?? ["text"]) as ("text" | "image")[],
    ...(definition.inputLimits === undefined ? {} : { inputLimits: definition.inputLimits }),
    cost: definition.cost ?? { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    ...(definition.promptCache === undefined ? {} : { promptCache: definition.promptCache }),
    contextWindow: definition.contextWindow ?? 128000,
    maxTokens: definition.maxTokens ?? 16384,
    ...(definition.samplingParams === undefined
      ? {}
      : { samplingParams: definition.samplingParams }),
    ...(definition.samplingParamsByThinkingLevel === undefined
      ? {}
      : { samplingParamsByThinkingLevel: definition.samplingParamsByThinkingLevel }),
    ...(compat === undefined ? {} : { compat }),
  };
}

function findModelDefaults(
  models: readonly aiTypes.AnyModel[],
  modelId: string,
  api?: aiTypes.Api,
): aiTypes.Model<aiTypes.Api> | undefined {
  const chatModels = models.filter((model) => isModelType(model, "chat"));
  return (
    chatModels.find((model) => model.id === modelId) ??
    (api === undefined ? undefined : chatModels.find((model) => model.api === api)) ??
    chatModels.find((model) => model.api === "openai-completions") ??
    chatModels[0]
  );
}

function findExtensionModelDefaults(
  models: readonly aiTypes.AnyModel[],
  definition: providerComposerTypes.ProviderModelConfig,
): aiTypes.AnyModel | undefined {
  const type = definition.type ?? "chat";
  const candidates = models.filter((model) => isModelType(model, type));
  return (
    candidates.find((model) => model.id === definition.id) ??
    (definition.api === undefined
      ? undefined
      : candidates.find((model) => model.api === definition.api)) ??
    (type === "chat"
      ? candidates.find((model) => model.api === "openai-completions")
      : undefined) ??
    candidates[0]
  );
}

function extensionModelFromDefinition(
  providerId: string,
  models: readonly aiTypes.AnyModel[],
  config: providerComposerTypes.ProviderConfigInput,
  definition: providerComposerTypes.ProviderModelConfig,
): aiTypes.AnyModel {
  const type = definition.type ?? "chat";
  const defaults = findExtensionModelDefaults(models, definition);
  const api = definition.api ?? (type === "chat" ? config.api : undefined) ?? defaults?.api;
  if (api === undefined) {
    throw new Error(
      `Provider ${providerId}, model ${definition.id}: no "api" specified. Set it at model level${type === "chat" ? " or provider level" : ""}.`,
    );
  }
  const baseUrl = definition.baseUrl ?? config.baseUrl ?? defaults?.baseUrl;
  if (baseUrl === undefined || baseUrl === "")
    throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
  const { headers: _headers, ...fields } = definition;
  if (fields.type === "image") {
    return { ...fields, api: api as aiTypes.ImageApi, baseUrl, provider: providerId };
  }
  if (fields.type === "classifier") {
    return { ...fields, api: api as aiTypes.ClassifierApi, baseUrl, provider: providerId };
  }
  return { ...fields, api: api as aiTypes.Api, baseUrl, provider: providerId };
}

function applyModelsJson(
  providerId: string,
  baseModels: readonly aiTypes.AnyModel[],
  config: modelConfigTypes.ModelsJsonProvider | undefined,
): aiTypes.AnyModel[] {
  if (config === undefined) return [...baseModels];
  const hasOverrides = config.modelOverrides && Object.keys(config.modelOverrides).length > 0;
  if (
    (config.models?.length === undefined || config.models?.length === 0) &&
    (config.baseUrl === undefined || config.baseUrl === "") &&
    config.headers === undefined &&
    config.compat === undefined &&
    hasOverrides !== true &&
    (config.apiKey === undefined || config.apiKey === "") &&
    config.authHeader === undefined
  ) {
    throw new Error(
      `Provider ${providerId}: must specify "baseUrl", "headers", "compat", "modelOverrides", or "models".`,
    );
  }

  const models: aiTypes.AnyModel[] = baseModels.map((model) => {
    const baseUrl = config.baseUrl ?? model.baseUrl;
    return isModelType(model, "chat")
      ? { ...model, baseUrl, compat: mergeCompat(model.compat, config.compat) }
      : { ...model, baseUrl };
  });
  for (const definition of config.models ?? []) {
    const existingIndex = models.findIndex(
      (model) => isModelType(model, "chat") && model.id === definition.id,
    );
    const defaults = findModelDefaults(models, definition.id, definition.api ?? config.api);
    const model = modelFromJson(providerId, definition, config, defaults);
    if (existingIndex >= 0) models[existingIndex] = model;
    else models.push(model);
  }
  return models;
}

function applyExtension(
  providerId: string,
  models: readonly aiTypes.AnyModel[],
  config: providerComposerTypes.ProviderConfigInput | undefined,
): aiTypes.AnyModel[] {
  if (config === undefined) return [...models];
  if (config.models === undefined) {
    return config.baseUrl !== undefined && config.baseUrl !== ""
      ? models.map((model) => ({ ...model, baseUrl: config.baseUrl! }))
      : [...models];
  }
  return config.models.map((definition) =>
    extensionModelFromDefinition(providerId, models, config, definition),
  );
}

function validateExtensionProvider(
  providerId: string,
  base: aiTypes.Provider | undefined,
  modelsConfig: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput,
): void {
  if (extension.streamSimple !== undefined && extension.api === undefined) {
    throw new Error(`Provider ${providerId}: "api" is required when registering streamSimple.`);
  }
  applyExtension(
    providerId,
    applyModelsJson(providerId, getAllProviderModels(base), modelsConfig),
    extension,
  );
}

const providerModels = {
  applyExtension,
  applyModelsJson,
  getAllProviderModels,
  validateExtensionProvider,
};

export default providerModels;
