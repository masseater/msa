import type { Api, Model } from "@msa/ai";

export const mockModels: Model<"anthropic-messages">[] = [
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    api: "anthropic-messages" as const,
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    api: "anthropic-messages" as const,
    provider: "openai",
    baseUrl: "https://api.openai.com",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
    contextWindow: 128000,
    maxTokens: 4096,
  },
];

export const mockOpenRouterModels: Model<"anthropic-messages">[] = [
  {
    id: "qwen/qwen3-coder:exacto",
    name: "Qwen3 Coder Exacto",
    api: "anthropic-messages" as const,
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "openai/gpt-4o:extended",
    name: "GPT-4o Extended",
    api: "anthropic-messages" as const,
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
    contextWindow: 128000,
    maxTokens: 4096,
  },
];

export const allModels = [...mockModels, ...mockOpenRouterModels];

function referenceModel(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions" as const,
    provider,
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

export const referenceCatalog = [
  referenceModel("anthropic", "claude-sonnet-4-5"),
  referenceModel("anthropic", "claude-sonnet-4-5-20250929"),
  referenceModel("anthropic", "claude-opus-4-8"),
  referenceModel("anthropic", "exact"),

  referenceModel("anthropic", "shared-pro"),
  referenceModel("openai", "gpt-4o"),
  referenceModel("openrouter", "qwen/qwen3-coder:exacto"),
  referenceModel("openrouter", "openai/gpt-4o:extended"),
  referenceModel("gw-a", "shared"),
  referenceModel("gw-a", "anthropic/future"),
  referenceModel("gw-a", "anthropic/exact"),
  referenceModel("gw-a", "anthropic/claude-opus-4.8"),
  referenceModel("gw-a", "anthropic/claude-opus"),
  referenceModel("gw-b", "shared"),
  referenceModel("gw-b", "anthropic/future"),
  referenceModel("gw-b", "claude-opus-4-8"),
  referenceModel("gw-b", "gw-b/free"),
  referenceModel("gw-b", "zz:free"),
];

export function modelRef(m: Model<Api>): string {
  return `${m.provider}/${m.id}`;
}
