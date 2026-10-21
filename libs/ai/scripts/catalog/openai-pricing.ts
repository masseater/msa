import type typesModule from "../../src/types.types.ts";
import modelsDev from "./models-dev.ts";

const { roundCost } = modelsDev;

const OPENAI_LONG_CONTEXT_INPUT_THRESHOLD = 272000;

const OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

const OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

const OPENAI_SERVICE_TIERS = { flex: 0.5, priority: 2 } satisfies NonNullable<
  typesModule.ModelCost["serviceTiers"]
>;

const OPENAI_PRIORITY_SURCHARGED_MODEL_IDS = new Set(["gpt-5.5"]);

function openAiServiceTiers(modelId: string): NonNullable<typesModule.ModelCost["serviceTiers"]> {
  return OPENAI_PRIORITY_SURCHARGED_MODEL_IDS.has(modelId)
    ? { ...OPENAI_SERVICE_TIERS, priority: 2.5 }
    : OPENAI_SERVICE_TIERS;
}

function withOpenAiLongContextPricing(
  cost: typesModule.Model<typesModule.Api>["cost"],
): typesModule.Model<typesModule.Api>["cost"] {
  return {
    ...cost,
    tiers: [
      {
        cacheRead: roundCost(cost.cacheRead * 2),
        cacheWrite: roundCost(cost.cacheWrite * 2),
        input: roundCost(cost.input * 2),
        inputTokensAbove: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
        output: roundCost(cost.output * 1.5),
      },
    ],
  };
}

const OPENAI_STANDARD_COSTS = {
  "gpt-5.6-luna": { cacheRead: 0.02, cacheWrite: 0.25, input: 0.2, output: 1.2 },
  "gpt-5.6-sol": { cacheRead: 0.4, cacheWrite: 5, input: 4, output: 20 },
  "gpt-5.6-terra": { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 12 },
  "gpt-6-astra": { cacheRead: 1, cacheWrite: 12.5, input: 10, output: 50 },
  "gpt-6-luna": { cacheRead: 0.01, cacheWrite: 0.125, input: 0.1, output: 0.5 },
  "gpt-6-sol": { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 },
  "gpt-6.1-sol": { cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10 },
} satisfies Record<string, typesModule.ModelCost>;

const OPENAI_STANDARD_COSTS_BY_ID: Readonly<Record<string, typesModule.ModelCost>> =
  OPENAI_STANDARD_COSTS;

const openaiPricing = {
  OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
  OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS,
  OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS,
  OPENAI_STANDARD_COSTS,
  OPENAI_STANDARD_COSTS_BY_ID,
  openAiServiceTiers,
  withOpenAiLongContextPricing,
};

export default openaiPricing;
