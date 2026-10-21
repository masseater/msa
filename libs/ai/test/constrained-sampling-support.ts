import type typesModule from "../src/types.types.ts";

function makeModel(): typesModule.Model<"openai-responses"> {
  return {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "gpt-test",
    input: ["text", "image"],
    maxTokens: 4096,
    name: "GPT Test",
    provider: "openai",
    reasoning: false,
  };
}

function makeUsage(): typesModule.AssistantMessage["usage"] {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  };
}

const constrainedSamplingSupport = {
  makeModel,
  makeUsage,
};

export default constrainedSamplingSupport;
