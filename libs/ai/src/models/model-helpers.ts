import { Function } from "effect";

import type { AnyModel, Api, Model, ModelCostRates, ModelThinkingLevel, Usage } from "../types.ts";
import { getModelType, isModelType } from "../utils/model-operations.ts";

export const hasApi: {
  <TApi extends Api>(api: TApi): (model: AnyModel) => model is Model<TApi>;
  <TApi extends Api>(model: AnyModel, api: TApi): model is Model<TApi>;
} = Function.dual(
  2,
  <TApi extends Api>(model: AnyModel, api: TApi): model is Model<TApi> =>
    isModelType(model, "chat") && model.api === api,
);

const costRates = (model: AnyModel, inputTokens: number): ModelCostRates => {
  let rates: ModelCostRates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }
  return rates;
};

export const calculateCost: {
  (usage: Usage): (model: AnyModel) => Usage["cost"];
  (model: AnyModel, usage: Usage): Usage["cost"];
} = Function.dual(2, (model: AnyModel, usage: Usage): Usage["cost"] => {
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
});

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const getSupportedThinkingLevels = <TApi extends Api>(
  model: Model<TApi>,
): ModelThinkingLevel[] => {
  if (!model.reasoning) return ["off"];

  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
};

export const clampThinkingLevel: {
  (level: ModelThinkingLevel): <TApi extends Api>(model: Model<TApi>) => ModelThinkingLevel;
  <TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel;
} = Function.dual(
  2,
  <TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel => {
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

export const modelsAreEqual: {
  (b: AnyModel | null | undefined): (a: AnyModel | null | undefined) => boolean;
  (a: AnyModel | null | undefined, b: AnyModel | null | undefined): boolean;
} = Function.dual(2, (a: AnyModel | null | undefined, b: AnyModel | null | undefined): boolean => {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return getModelType(a) === getModelType(b) && a.id === b.id && a.provider === b.provider;
});
