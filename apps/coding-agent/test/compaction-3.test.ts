import type agentTypes from "@msa/agent-core/index.types";
import { describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import compactionSupport from "./compaction-support.ts";

const { createAssistantMessage, createMockUsage, createUserMessage } = compactionSupport;

const { estimateContextTokens } = compaction;

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
