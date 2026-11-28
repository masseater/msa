import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";

const { currentTimeMillis } = testing;

function createAssistantMessage(
  content: aiTypes.AssistantMessage["content"],
  overrides: Partial<Pick<aiTypes.AssistantMessage, "stopReason">> = {},
): aiTypes.AssistantMessage {
  return {
    api: "openai-responses" as const,
    content,
    model: "gpt-4o-mini",
    provider: "openai",
    role: "assistant",
    stopReason: overrides.stopReason ?? "stop",
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

const assistantMessageSupport = {
  createAssistantMessage,
};

export default assistantMessageSupport;
