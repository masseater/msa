import type aiTypes from "@msa/ai/index.types";

import type modelConfigTypes from "../model-config.types.ts";

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

const modelOverrides = { applyModelOverride, mergeCompat };

export default modelOverrides;
