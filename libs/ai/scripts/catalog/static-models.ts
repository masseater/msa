import type { ClassifierModel, Model } from "../../src/types.ts";

export const FALLBACK_MODELS: Model<any>[] = [
  {
    id: "auto",
    name: "Auto",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 2000000,
    maxTokens: 30000,
  },
  {
    id: "openrouter/fusion",
    name: "OpenRouter: Fusion",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 30000,
  },
];

export const OPENCODE_CLASSIFIER_MODELS: ClassifierModel<"typesafe-system-one">[] = [
  {
    type: "classifier",
    id: "jev-1.13",
    name: "Jev 1.13",
    api: "typesafe-system-one",
    provider: "opencode",
    baseUrl: "https://opencode.ai/inference/v1",
    input: ["text"],
    cost: { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
  },
  {
    type: "classifier",
    id: "jev-1.13-free",
    name: "Jev 1.13 Free",
    api: "typesafe-system-one",
    provider: "opencode",
    baseUrl: "https://opencode.ai/inference/v1",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
  },
];
