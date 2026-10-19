import type { Message } from "@msa/ai";
import { currentTimeMillis } from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import { serializeConversation } from "../src/core/compaction/utils.ts";

describe("serializeConversation", () => {
  it("should truncate long tool results", () => {
    const longContent = "x".repeat(5000);
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "read",
        content: [{ type: "text", text: longContent }],
        isError: false,
        timestamp: currentTimeMillis(),
      },
    ];

    const result = serializeConversation(messages);

    expect(result).toContain("[Tool result]:");
    expect(result).toContain("[... 3000 more characters truncated]");
    expect(result).not.toContain("x".repeat(3000));

    expect(result).toContain("x".repeat(2000));
  });

  it("should not truncate short tool results", () => {
    const shortContent = "x".repeat(1500);
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "read",
        content: [{ type: "text", text: shortContent }],
        isError: false,
        timestamp: currentTimeMillis(),
      },
    ];

    const result = serializeConversation(messages);

    expect(result).toBe(`[Tool result]: ${shortContent}`);
    expect(result).not.toContain("truncated");
  });

  it("should not truncate assistant or user messages", () => {
    const longText = "y".repeat(5000);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: longText }],
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [{ type: "text", text: longText }],
        api: "anthropic",
        provider: "anthropic-api",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: currentTimeMillis(),
      },
    ];

    const result = serializeConversation(messages);

    expect(result).not.toContain("truncated");
    expect(result).toContain(longText);
  });

  it("should omit thinking", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning", thinkingSignature: "sig" },
          { type: "text", text: "visible reply" },
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } },
        ],
        api: "anthropic",
        provider: "anthropic-api",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ];

    const result = serializeConversation(messages);

    expect(result).toBe('[Assistant]: visible reply\n\n[Assistant tool calls]: read(path="a.ts")');
  });
});
