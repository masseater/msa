import { describe, expect, it } from "vite-plus/test";

import simpleOptions from "../src/api/simple-options.ts";
import type typesModule from "../src/types.types.ts";
import estimate from "../src/utils/estimate.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { estimateContextTokens } = estimate;
const { buildBaseOptions } = simpleOptions;

function createUsage(totalTokens: number): typesModule.Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: totalTokens,
    output: 0,
    totalTokens,
  };
}

function createAssistant(timestamp: number, totalTokens: number): typesModule.AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text: "kept", type: "text" }],
    model: "test-model",
    provider: "openai",
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: createUsage(totalTokens),
  };
}

const model: typesModule.Model<"openai-responses"> = {
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 10_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 8_000,
  name: "Test Model",
  provider: "openai",
  reasoning: false,
};

describe("context token estimation", () => {
  it("reserves 3.5 characters per token for new text when limiting output", () => {
    const context = normalizeContext({
      messages: [
        createAssistant(100, 2_000),
        { content: "x".repeat(3_500), role: "user", timestamp: 200 },
      ],
    });

    expect(estimateContextTokens(context)).toEqual({
      lastUsageIndex: 0,
      tokens: 3_000,
      trailingTokens: 1_000,
      usageTokens: 2_000,
    });
    expect(buildBaseOptions(model, context).maxTokens).toBe(2_904);
  });

  it("ignores stale assistant usage after a newer message is inserted before it", () => {
    const context = normalizeContext({
      messages: [
        { content: "summary", role: "user", timestamp: 200 },
        createAssistant(100, 9_500),
        { content: "x".repeat(4_000), role: "user", timestamp: 300 },
      ],
      systemPrompt: "system",
    });

    expect(estimateContextTokens(context)).toEqual({
      lastUsageIndex: null,
      tokens: 1_149,
      trailingTokens: 1_149,
      usageTokens: 0,
    });
    expect(buildBaseOptions(model, context).maxTokens).toBe(4_755);
  });
});

describe("context token estimation", () => {
  it("uses assistant usage again after a response to the inserted context", () => {
    const context = normalizeContext({
      messages: [
        { content: "summary", role: "user", timestamp: 200 },
        createAssistant(100, 9_500),
        { content: "new prompt", role: "user", timestamp: 300 },
        createAssistant(400, 2_000),
        { content: "tail", role: "user", timestamp: 500 },
      ],
    });

    expect(estimateContextTokens(context)).toEqual({
      lastUsageIndex: 3,
      tokens: 2_002,
      trailingTokens: 2,
      usageTokens: 2_000,
    });
  });
});
