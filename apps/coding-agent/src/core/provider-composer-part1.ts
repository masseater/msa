import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type modelConfigTypes from "./model-config.types.ts";
import type providerComposerTypes from "./provider-composer.types.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";

const { clearConfigValueCache } = resolveConfigValueModule;
const { isModelType } = ai;

const clearApiKeyCache = clearConfigValueCache;

function getAllProviderModels(provider: aiTypes.Provider | undefined): readonly aiTypes.AnyModel[] {
  return provider === undefined ? [] : (provider.getAllModels?.() ?? provider.getModels());
}

function mergeCompat(
  base: aiTypes.Model<aiTypes.Api>["compat"],
  override:
    | aiTypes.Model<aiTypes.Api>["compat"]
    | modelConfigTypes.ModelsJsonModelOverride["compat"],
): aiTypes.Model<aiTypes.Api>["compat"] {
  if (override === undefined) return base;
  const merged = { ...base, ...override } as NonNullable<aiTypes.Model<aiTypes.Api>["compat"]>;
  const baseNested = base as Record<string, unknown> | undefined;
  const overrideNested = override as Record<string, unknown>;
  const mergedNested = merged as Record<string, unknown>;
  for (const key of ["openRouterRouting", "chatTemplateKwargs"] as const) {
    const baseValue = baseNested?.[key];
    const overrideValue = overrideNested[key];
    if (
      (typeof baseValue === "object" && baseValue !== null) ||
      (typeof overrideValue === "object" && overrideValue !== null)
    ) {
      mergedNested[key] = {
        ...(baseValue as object | undefined),
        ...(overrideValue as object | undefined),
      };
    }
  }
  return merged;
}

function mergeInputLimits(
  base: aiTypes.Model<aiTypes.Api>["inputLimits"],
  override: modelConfigTypes.ModelsJsonModelOverride["inputLimits"],
): aiTypes.Model<aiTypes.Api>["inputLimits"] {
  if (override === undefined) return base;
  return {
    ...base,
    ...override,
    ...(override.images === undefined
      ? {}
      : {
          images: {
            ...base?.images,
            ...override.images,
            ...(override.images.resize === undefined
              ? {}
              : { resize: { ...base?.images?.resize, ...override.images.resize } }),
          },
        }),
  };
}

function mergeSamplingParamsByThinkingLevel(
  base: aiTypes.Model<aiTypes.Api>["samplingParamsByThinkingLevel"],
  override: aiTypes.Model<aiTypes.Api>["samplingParamsByThinkingLevel"],
): aiTypes.Model<aiTypes.Api>["samplingParamsByThinkingLevel"] {
  if (override === undefined) return base;
  const merged = { ...base };
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
    const params = override[level];
    if (params !== undefined) merged[level] = { ...base?.[level], ...params };
  }
  return merged;
}

function applyModelOverride(
  model: aiTypes.Model<aiTypes.Api>,
  override: modelConfigTypes.ModelsJsonModelOverride,
): aiTypes.Model<aiTypes.Api> {
  const inputLimits = mergeInputLimits(model.inputLimits, override.inputLimits);
  const tiers = override.cost?.tiers ?? model.cost.tiers;
  const samplingParamsByThinkingLevel = mergeSamplingParamsByThinkingLevel(
    model.samplingParamsByThinkingLevel,
    override.samplingParamsByThinkingLevel,
  );
  const compat = mergeCompat(model.compat, override.compat);
  return {
    ...model,
    name: override.name ?? model.name,
    reasoning: override.reasoning ?? model.reasoning,
    ...(override.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: { ...model.thinkingLevelMap, ...override.thinkingLevelMap } }),
    input: (override.input as ("text" | "image")[] | undefined) ?? model.input,
    ...(inputLimits === undefined ? {} : { inputLimits }),
    cost:
      override.cost === undefined
        ? model.cost
        : {
            cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
            cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
            input: override.cost.input ?? model.cost.input,
            output: override.cost.output ?? model.cost.output,
            ...(tiers === undefined ? {} : { tiers }),
          },
    ...(override.promptCache === undefined
      ? {}
      : { promptCache: { ...model.promptCache, ...override.promptCache } }),
    contextWindow: override.contextWindow ?? model.contextWindow,
    maxTokens: override.maxTokens ?? model.maxTokens,
    ...(override.samplingParams === undefined
      ? {}
      : { samplingParams: { ...model.samplingParams, ...override.samplingParams } }),
    ...(samplingParamsByThinkingLevel === undefined ? {} : { samplingParamsByThinkingLevel }),
    ...(compat === undefined ? {} : { compat }),
  };
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

const providerComposerPart1 = {
  applyModelOverride,
  applyModelsJson,
  clearApiKeyCache,
  extensionModelFromDefinition,
  getAllProviderModels,
};

export default providerComposerPart1;
