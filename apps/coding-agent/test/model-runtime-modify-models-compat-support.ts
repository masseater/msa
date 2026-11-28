import type aiTypes from "@msa/ai/index.types";

function model(id: string): aiTypes.Model<"openai-completions"> {
  return {
    api: "openai-completions" as const,
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 100,
    name: id,
    provider: "extension-oauth",
    reasoning: false,
  };
}

const modelRuntimeModifyModelsCompatSupport = {
  model,
};

export default modelRuntimeModifyModelsCompatSupport;
