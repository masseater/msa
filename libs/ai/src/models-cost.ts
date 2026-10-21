import { Function } from "effect";

import modelsKit from "./models-kit.ts";
import type typesModuleModule2 from "./types.types.ts";

const { modelOperations } = modelsKit;
const { getModelType, isModelType } = modelOperations;

const hasApi: {
  <TApi extends typesModuleModule2.Api>(
    api: TApi,
  ): (model: typesModuleModule2.AnyModel) => model is typesModuleModule2.Model<TApi>;
  <TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.AnyModel,
    api: TApi,
  ): model is typesModuleModule2.Model<TApi>;
} = Function.dual(
  2,
  <TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.AnyModel,
    api: TApi,
  ): model is typesModuleModule2.Model<TApi> => isModelType(model, "chat") && model.api === api,
);

const costRates = (
  model: typesModuleModule2.AnyModel,
  inputTokens: number,
): typesModuleModule2.ModelCostRates => {
  let rates: typesModuleModule2.ModelCostRates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }
  return rates;
};

const calculateCost: {
  (
    usage: typesModuleModule2.Usage,
  ): (model: typesModuleModule2.AnyModel) => typesModuleModule2.Usage["cost"];
  (
    model: typesModuleModule2.AnyModel,
    usage: typesModuleModule2.Usage,
  ): typesModuleModule2.Usage["cost"];
} = Function.dual(
  2,
  (
    model: typesModuleModule2.AnyModel,
    usage: typesModuleModule2.Usage,
  ): typesModuleModule2.Usage["cost"] => {
    const rates = costRates(model, usage.input + usage.cacheRead + usage.cacheWrite);
    const longWrite = usage.cacheWrite1h ?? 0;
    const shortWrite = usage.cacheWrite - longWrite;
    usage.cost.input = (rates.input / 1000000) * usage.input;
    usage.cost.output = (rates.output / 1000000) * usage.output;
    usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
    usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
    usage.cost.total =
      usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
    return usage.cost;
  },
);

const EXTENDED_THINKING_LEVELS: typesModuleModule2.ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const getSupportedThinkingLevels = <TApi extends typesModuleModule2.Api>(
  model: typesModuleModule2.Model<TApi>,
): typesModuleModule2.ModelThinkingLevel[] => {
  if (!model.reasoning) return ["off"];

  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
};

const clampThinkingLevel: {
  (
    level: typesModuleModule2.ModelThinkingLevel,
  ): <TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.Model<TApi>,
  ) => typesModuleModule2.ModelThinkingLevel;
  <TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.Model<TApi>,
    level: typesModuleModule2.ModelThinkingLevel,
  ): typesModuleModule2.ModelThinkingLevel;
} = Function.dual(
  2,
  <TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.Model<TApi>,
    level: typesModuleModule2.ModelThinkingLevel,
  ): typesModuleModule2.ModelThinkingLevel => {
    const availableLevels = getSupportedThinkingLevels(model);
    if (availableLevels.includes(level)) return level;

    const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
    if (requestedIndex === -1) return availableLevels[0] ?? "off";

    const above = EXTENDED_THINKING_LEVELS.slice(requestedIndex);
    const below = EXTENDED_THINKING_LEVELS.slice(0, requestedIndex).reverse();
    return (
      [...above, ...below].find((candidate) => availableLevels.includes(candidate)) ??
      availableLevels[0] ??
      "off"
    );
  },
);

const modelsAreEqual: {
  (
    b: typesModuleModule2.AnyModel | null | undefined,
  ): (a: typesModuleModule2.AnyModel | null | undefined) => boolean;
  (
    a: typesModuleModule2.AnyModel | null | undefined,
    b: typesModuleModule2.AnyModel | null | undefined,
  ): boolean;
} = Function.dual(
  2,
  (
    a: typesModuleModule2.AnyModel | null | undefined,
    b: typesModuleModule2.AnyModel | null | undefined,
  ): boolean => {
    if (a === undefined || a === null || b === undefined || b === null) return false;
    return getModelType(a) === getModelType(b) && a.id === b.id && a.provider === b.provider;
  },
);

const modelsCost = {
  EXTENDED_THINKING_LEVELS,
  calculateCost,
  clampThinkingLevel,
  costRates,
  getSupportedThinkingLevels,
  hasApi,
  modelsAreEqual,
};

export default modelsCost;
