import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import { currentTimeMillis } from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import { estimateContextTokens } from "../src/core/compaction/index.ts";

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createUserMessage(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: currentTimeMillis() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text }],
    usage: usage || createMockUsage(100, 50),
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    api: "anthropic-messages" as const,
    provider: "anthropic-api",
    model: "claude-sonnet-4-5",
  };
}

describe("estimateContextTokens", () => {
  it("uses the last non-zero assistant usage as the context anchor", () => {
    const messages: AgentMessage[] = [
      createUserMessage("Hello"),
      createAssistantMessage("Hi", createMockUsage(100, 50)),
      createUserMessage("continue"),
      createAssistantMessage("Partial thinking", createMockUsage(0, 0)),
    ];

    const estimate = estimateContextTokens(messages);

    expect(estimate.usageTokens).toBe(150);
    expect(estimate.lastUsageIndex).toBe(1);
    expect(estimate.trailingTokens).toBeGreaterThan(0);
    expect(estimate.tokens).toBe(150 + estimate.trailingTokens);
  });
});
