import type compatTypes from "@msa/ai/compat.types";

import { type ModelRegistry, type ProviderConfigInput } from "../src/core/model-registry.ts";

function providerConfig(
  baseUrl: string,
  models: Array<{ id: string; name?: string }>,
  api: string = "anthropic-messages",
): ProviderConfigInput {
  return {
    api: api as compatTypes.Api,
    apiKey: "test-key",
    baseUrl,
    models: models.map((m) => ({
      contextWindow: 100000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: m.id,
      input: ["text"],
      maxTokens: 8000,
      name: m.name ?? m.id,
      reasoning: false,
    })),
  };
}

function getModelsForProvider(registry: ModelRegistry, provider: string) {
  return registry.getAll().filter((m) => m.provider === provider);
}

const modelRegistry4Support = {
  getModelsForProvider,
  providerConfig,
};

export default modelRegistry4Support;
