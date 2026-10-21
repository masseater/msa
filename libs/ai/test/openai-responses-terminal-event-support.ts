import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";

const { currentTimeMillis } = clock;

function createModel(): typesModule.Model<"openai-responses"> {
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

function createOutput(model: typesModule.Model<"openai-responses">): typesModule.AssistantMessage {
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
