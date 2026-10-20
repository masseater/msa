import { describe, expect, it } from "vite-plus/test";

import { transformMessages } from "../src/api/transform-messages.ts";
import type { Message, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

function makeTextOnlyModel(): Model<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "https://example.invalid/v1",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "test-model",
    input: ["text"],
    maxTokens: 16000,
    name: "Test Model",
    provider: "openai",
    reasoning: false,
  };
}

describe("lax message content handling", () => {
  it("normalizes null/missing content to an empty array instead of crashing", () => {
    const messages = [
      { content: null, role: "user", timestamp: currentTimeMillis() },
      {
        api: "openai-completions",
        content: null,
        model: "test-model",
        provider: "openai",
        role: "assistant",
        stopReason: "stop",
        timestamp: currentTimeMillis(),
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      {
        isError: false,
        role: "toolResult",
        timestamp: currentTimeMillis(),
        toolCallId: "call_1",
        toolName: "web_search",
      },
    ] as unknown as Message[];

    const result = transformMessages(messages, makeTextOnlyModel());

    expect(result).toHaveLength(3);
    for (const msg of result) {
      expect(msg.content).toEqual([]);
    }
  });
});
