import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import { estimateContextTokens } from "../src/core/compaction/index.ts";

const { currentTimeMillis } = testing;

function createMockUsage(
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
): compatTypes.Usage {
  return {
    cacheRead,
    cacheWrite,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input,
    output,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
}

function createUserMessage(text: string): agentTypes.AgentMessage {
  return { content: text, role: "user", timestamp: currentTimeMillis() };
}

function createAssistantMessage(
  text: string,
  usage?: compatTypes.Usage,
): compatTypes.AssistantMessage {
  return {
    api: "anthropic-messages" as const,
    content: [{ text, type: "text" as const }],
    model: "claude-sonnet-4-5",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: usage || createMockUsage(100, 50),
  };
}

const usesTheLastNonZeroAssistantUsage = () => {
  const messages: agentTypes.AgentMessage[] = [
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
};

describe("estimateContextTokens", () => {
  it(
    "uses the last non-zero assistant usage as the context anchor",
    usesTheLastNonZeroAssistantUsage,
  );
});
