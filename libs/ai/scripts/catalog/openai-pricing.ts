import type { Api, Model, ModelCost } from "../../src/types.ts";
import { roundCost } from "./models-dev.ts";

export const OPENAI_LONG_CONTEXT_INPUT_THRESHOLD = 272000;

export const OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS = new Set([
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

export const OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS = new Set([
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

export function withOpenAiLongContextPricing(cost: Model<Api>["cost"]): Model<Api>["cost"] {
  return {
    ...cost,
    tiers: [
      {
        inputTokensAbove: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
        input: roundCost(cost.input * 2),
        output: roundCost(cost.output * 1.5),
        cacheRead: roundCost(cost.cacheRead * 2),
        cacheWrite: roundCost(cost.cacheWrite * 2),
      },
    ],
  };
}

export const OPENAI_STANDARD_COSTS = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
} satisfies Record<string, ModelCost>;

export const OPENAI_STANDARD_COSTS_BY_ID: Readonly<Record<string, ModelCost>> =
  OPENAI_STANDARD_COSTS;
