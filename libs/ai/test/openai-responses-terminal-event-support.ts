import type { AssistantMessage, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

function createModel(): Model<"openai-responses"> {
  return {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 400000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "gpt-5-mini",
    input: ["text"],
    maxTokens: 128000,
    name: "GPT-5 Mini",
    provider: "openai",
    reasoning: true,
  };
}

function createOutput(model: Model<"openai-responses">): AssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

const openaiResponsesTerminalEventSupport = {
  createModel,
  createOutput,
};

export default openaiResponsesTerminalEventSupport;
