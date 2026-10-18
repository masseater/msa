import type { ClassifierModel, Model } from "../../src/types.ts";
import {
  OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
  OPENAI_STANDARD_COSTS,
  withOpenAiLongContextPricing,
} from "./openai-pricing.ts";

type StandardOpenAiModelId = keyof typeof OPENAI_STANDARD_COSTS;

const STANDARD_OPENAI_MODEL_NAMES: readonly (readonly [StandardOpenAiModelId, string])[] = [
  ["gpt-6.1-sol", "GPT-6.1 Sol"],
  ["gpt-6-astra", "GPT-6 Astra"],
  ["gpt-6-sol", "GPT-6 Sol"],
  ["gpt-6-luna", "GPT-6 Luna"],
  ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ["gpt-5.6-luna", "GPT-5.6 Luna"],
];

const standardOpenAiFields = ([id, name]: readonly [StandardOpenAiModelId, string]) => ({
  id,
  name,
  reasoning: true,
  input: ["text", "image"] as ("text" | "image")[],
  cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS[id]),
  maxTokens: 128000,
});

export const MISSING_OPENAI_MODELS: Model<"openai-responses">[] = [
  ...STANDARD_OPENAI_MODEL_NAMES.map((entry) => ({
    ...standardOpenAiFields(entry),
    api: "openai-responses" as const,
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
  })),
  {
    id: "gpt-5-chat-latest",
    name: "GPT-5 Chat Latest",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
];

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_CONTEXT = 272000;
const CODEX_CONTEXT_BY_ID: Readonly<Record<string, number>> = { "gpt-6.1-sol": 500000 };
const CODEX_MAX_TOKENS = 128000;

const codexModel = (
  fields: Omit<Model<"openai-codex-responses">, "api" | "provider" | "baseUrl" | "maxTokens">,
): Model<"openai-codex-responses"> => ({
  ...fields,
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: CODEX_BASE_URL,
  maxTokens: CODEX_MAX_TOKENS,
});

export const CODEX_MODELS: Model<"openai-codex-responses">[] = [
  ...STANDARD_OPENAI_MODEL_NAMES.map((entry) =>
    codexModel({
      ...standardOpenAiFields(entry),
      contextWindow: CODEX_CONTEXT_BY_ID[entry[0]] ?? CODEX_CONTEXT,
    }),
  ),
  codexModel({
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    reasoning: true,
    input: ["text"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 128000,
  }),
  codexModel({
    id: "gpt-5.5",
    name: "GPT-5.5",
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({ input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }),
    contextWindow: CODEX_CONTEXT,
  }),
];

export const OPENAI_CLASSIFIER_MODELS: ClassifierModel<"openai-decisions">[] = [
  {
    type: "classifier",
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    api: "openai-decisions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({ input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 }),
    contextWindow: 922000,
  },
];
