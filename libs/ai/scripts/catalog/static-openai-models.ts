import type { ClassifierModel, Model } from "../../src/types.ts";
import openaiPricing from "./openai-pricing.ts";

const { OPENAI_LONG_CONTEXT_INPUT_THRESHOLD, OPENAI_STANDARD_COSTS, withOpenAiLongContextPricing } =
  openaiPricing;

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
  cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS[id]),
  id,
  input: ["text", "image"] as ("text" | "image")[],
  maxTokens: 128000,
  name,
  reasoning: true,
});

const MISSING_OPENAI_MODELS: Model<"openai-responses">[] = [
  ...STANDARD_OPENAI_MODEL_NAMES.map((entry) => ({
    ...standardOpenAiFields(entry),
    api: "openai-responses" as const,
    baseUrl: "https://api.openai.com/v1",
    contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
    provider: "openai",
  })),
  {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
    cost: { cacheRead: 0.125, cacheWrite: 0, input: 1.25, output: 10 },
    id: "gpt-5-chat-latest",
    input: ["text", "image"],
    maxTokens: 16384,
    name: "GPT-5 Chat Latest",
    provider: "openai",
    reasoning: false,
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
  baseUrl: CODEX_BASE_URL,
  maxTokens: CODEX_MAX_TOKENS,
  provider: "openai-codex",
});

const CODEX_MODELS: Model<"openai-codex-responses">[] = [
  ...STANDARD_OPENAI_MODEL_NAMES.map((entry) =>
    codexModel({
      ...standardOpenAiFields(entry),
      contextWindow: CODEX_CONTEXT_BY_ID[entry[0]] ?? CODEX_CONTEXT,
    }),
  ),
  codexModel({
    contextWindow: 128000,
    cost: { cacheRead: 0.175, cacheWrite: 0, input: 1.75, output: 14 },
    id: "gpt-5.3-codex-spark",
    input: ["text"],
    name: "GPT-5.3 Codex Spark",
    reasoning: true,
  }),
  codexModel({
    contextWindow: CODEX_CONTEXT,
    cost: withOpenAiLongContextPricing({ cacheRead: 0.5, cacheWrite: 0, input: 5, output: 30 }),
    id: "gpt-5.5",
    input: ["text", "image"],
    name: "GPT-5.5",
    reasoning: true,
  }),
];

const OPENAI_CLASSIFIER_MODELS: ClassifierModel<"openai-decisions">[] = [
  {
    api: "openai-decisions",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 922000,
    cost: withOpenAiLongContextPricing({ cacheRead: 0, cacheWrite: 0, input: 0.1, output: 0 }),
    id: "gpt-6-luna",
    input: ["text", "image"],
    name: "GPT-6 Luna",
    provider: "openai",
    type: "classifier",
  },
];

const staticOpenaiModels = {
  CODEX_MODELS,
  MISSING_OPENAI_MODELS,
  OPENAI_CLASSIFIER_MODELS,
};

export default staticOpenaiModels;
