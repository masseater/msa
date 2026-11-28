import type typesModule from "../../src/types.types.ts";

const FALLBACK_MODELS: typesModule.Model<any>[] = [
  {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 2000000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "auto",
    input: ["text", "image"],
    maxTokens: 30000,
    name: "Auto",
    provider: "openrouter",
    reasoning: true,
  },
  {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 1000000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "openrouter/fusion",
    input: ["text"],
    maxTokens: 30000,
    name: "OpenRouter: Fusion",
    provider: "openrouter",
    reasoning: true,
  },
];

const OPENCODE_CLASSIFIER_MODELS: typesModule.ClassifierModel<"typesafe-system-one">[] = [
  {
    api: "typesafe-system-one",
    baseUrl: "https://opencode.ai/inference/v1",
    contextWindow: 32000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0.042, output: 0 },
    id: "jev-1.13",
    input: ["text"],
    name: "Jev 1.13",
    provider: "opencode",
    type: "classifier",
  },
  {
    api: "typesafe-system-one",
    baseUrl: "https://opencode.ai/inference/v1",
    contextWindow: 32000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "jev-1.13-free",
    input: ["text"],
    name: "Jev 1.13 Free",
    provider: "opencode",
    type: "classifier",
  },
];

const staticModels = {
  FALLBACK_MODELS,
  OPENCODE_CLASSIFIER_MODELS,
};

export default staticModels;
