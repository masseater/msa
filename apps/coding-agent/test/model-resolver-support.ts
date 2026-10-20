import type aiTypes from "@msa/ai/index.types";

const mockModels: aiTypes.Model<"anthropic-messages">[] = [
  {
    api: "anthropic-messages" as const,
    baseUrl: "https://api.anthropic.com",
    contextWindow: 200000,
    cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
    id: "claude-sonnet-4-5",
    input: ["text", "image"],
    maxTokens: 8192,
    name: "Claude Sonnet 4.5",
    provider: "anthropic-api",
    reasoning: true,
  },
  {
    api: "anthropic-messages" as const,
    baseUrl: "https://api.openai.com",
    contextWindow: 128000,
    cost: { cacheRead: 0.5, cacheWrite: 5, input: 5, output: 15 },
    id: "gpt-4o",
    input: ["text", "image"],
    maxTokens: 4096,
    name: "GPT-4o",
    provider: "openai",
    reasoning: false,
  },
];

const mockOpenRouterModels: aiTypes.Model<"anthropic-messages">[] = [
  {
    api: "anthropic-messages" as const,
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 128000,
    cost: { cacheRead: 0.1, cacheWrite: 1, input: 1, output: 2 },
    id: "qwen/qwen3-coder:exacto",
    input: ["text"],
    maxTokens: 8192,
    name: "Qwen3 Coder Exacto",
    provider: "openrouter",
    reasoning: true,
  },
  {
    api: "anthropic-messages" as const,
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 128000,
    cost: { cacheRead: 0.5, cacheWrite: 5, input: 5, output: 15 },
    id: "openai/gpt-4o:extended",
    input: ["text", "image"],
    maxTokens: 4096,
    name: "GPT-4o Extended",
    provider: "openrouter",
    reasoning: false,
  },
];

const allModels = [...mockModels, ...mockOpenRouterModels];

function referenceModel(provider: string, id: string): aiTypes.Model<aiTypes.Api> {
  return {
    api: "openai-completions" as const,
    baseUrl: "https://example.invalid",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 8192,
    name: id,
    provider,
    reasoning: true,
  };
}

const referenceCatalog = [
  referenceModel("anthropic-api", "claude-sonnet-4-5"),
  referenceModel("anthropic-api", "claude-sonnet-4-5-20250929"),
  referenceModel("anthropic-api", "claude-opus-4-8"),
  referenceModel("anthropic-api", "exact"),

  referenceModel("anthropic-api", "shared-pro"),
  referenceModel("openai", "gpt-4o"),
  referenceModel("openrouter", "qwen/qwen3-coder:exacto"),
  referenceModel("openrouter", "openai/gpt-4o:extended"),
  referenceModel("gw-a", "shared"),
  referenceModel("gw-a", "anthropic-api/future"),
  referenceModel("gw-a", "anthropic-api/exact"),
  referenceModel("gw-a", "anthropic-api/claude-opus-4.8"),
  referenceModel("gw-a", "anthropic-api/claude-opus"),
  referenceModel("gw-b", "shared"),
  referenceModel("gw-b", "anthropic-api/future"),
  referenceModel("gw-b", "claude-opus-4-8"),
  referenceModel("gw-b", "gw-b/free"),
  referenceModel("gw-b", "zz:free"),
];

function modelRef(m: aiTypes.Model<aiTypes.Api>): string {
  return `${m.provider}/${m.id}`;
}

const modelResolverSupport = {
  allModels,
  mockModels,
  mockOpenRouterModels,
  modelRef,
  referenceCatalog,
};

export default modelResolverSupport;
