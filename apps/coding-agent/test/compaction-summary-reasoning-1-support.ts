import { type Model } from "@msa/ai";

function createModel(
  reasoning: boolean,
  maxTokens = 8192,
  compat?: Model<"anthropic-messages">["compat"],
): Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages" as const,
    baseUrl: "https://api.anthropic.com",
    contextWindow: 200000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: reasoning ? "reasoning-model" : "non-reasoning-model",
    input: ["text"],
    maxTokens,
    name: reasoning ? "Reasoning Model" : "Non-reasoning Model",
    provider: "anthropic-api",
    reasoning,
    ...(compat === undefined ? {} : { compat }),
  };
}

const compactionSummaryReasoning1Support = {
  createModel,
};

export default compactionSummaryReasoning1Support;
