import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import utils from "../src/core/compaction/utils.ts";

const { serializeConversation } = utils;

const { currentTimeMillis } = testing;

const shouldTruncateLongToolResults = () => {
  const longContent = "x".repeat(5000);
  const messages: aiTypes.Message[] = [
    {
      content: [{ text: longContent, type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: currentTimeMillis(),
      toolCallId: "tc1",
      toolName: "read",
    },
  ];

  const result = serializeConversation(messages);

  expect(result).toContain("[Tool result]:");
  expect(result).toContain("[... 3000 more characters truncated]");
  expect(result).not.toContain("x".repeat(3000));

  expect(result).toContain("x".repeat(2000));
};

const shouldNotTruncateShortToolResults = () => {
  const shortContent = "x".repeat(1500);
  const messages: aiTypes.Message[] = [
    {
      content: [{ text: shortContent, type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: currentTimeMillis(),
      toolCallId: "tc1",
      toolName: "read",
    },
  ];

  const result = serializeConversation(messages);

  expect(result).toBe(`[Tool result]: ${shortContent}`);
  expect(result).not.toContain("truncated");
};

const shouldNotTruncateAssistantOrUserMessages = () => {
  const longText = "y".repeat(5000);
  const messages: aiTypes.Message[] = [
    {
      content: [{ text: longText, type: "text" }],
      role: "user",
      timestamp: currentTimeMillis(),
    },
    {
      api: "anthropic",
      content: [{ text: longText, type: "text" }],
      model: "test",
      provider: "anthropic-api",
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
  ];

  const result = serializeConversation(messages);

  expect(result).not.toContain("truncated");
  expect(result).toContain(longText);
};

const shouldOmitThinking = () => {
  const messages: aiTypes.Message[] = [
    {
      api: "anthropic",
      content: [
        { thinking: "private reasoning", thinkingSignature: "sig", type: "thinking" },
        { text: "visible reply", type: "text" },
        { arguments: { path: "a.ts" }, id: "tc1", name: "read", type: "toolCall" },
      ],
      model: "test",
      provider: "anthropic-api",
      role: "assistant",
      stopReason: "toolUse",
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
  ];

  const result = serializeConversation(messages);

  expect(result).toBe('[Assistant]: visible reply\n\n[Assistant tool calls]: read(path="a.ts")');
};

describe("serializeConversation", () => {
  it("should truncate long tool results", shouldTruncateLongToolResults);

  it("should not truncate short tool results", shouldNotTruncateShortToolResults);

  it("should not truncate assistant or user messages", shouldNotTruncateAssistantOrUserMessages);

  it("should omit thinking", shouldOmitThinking);
});
