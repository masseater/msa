import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";

import type compactionTypes from "../src/core/compaction/index.types.ts";

const { currentTimeMillis } = testing;

function createModel(
  reasoning: boolean,
  maxTokens = 8192,
  compat?: aiTypes.Model<"anthropic-messages">["compat"],
): aiTypes.Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages" as const,
    baseUrl: "https://api.anthropic.com",
    contextWindow: 200000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: reasoning ? "reasoning-model" : "non-reasoning-model",
    input: ["text"],
    maxTokens,
    name: reasoning ? "Reasoning Model" : "Non-reasoning Model",
    provider: "anthropic-api",
    reasoning,
    ...(compat === undefined ? {} : { compat }),
  };
}

const mockSummaryResponse: aiTypes.AssistantMessage = {
  api: "anthropic-messages" as const,
  content: [{ text: "## Goal\nTest summary", type: "text" as const }],
  model: "claude-sonnet-4-5",
  provider: "anthropic-api",
  role: "assistant",
  stopReason: "stop",
  timestamp: currentTimeMillis(),
  usage: {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 10,
    output: 10,
    totalTokens: 20,
  },
};

const mockToolCallResponse: aiTypes.AssistantMessage = {
  ...mockSummaryResponse,
  content: [
    {
      arguments: { path: "README.md" },
      id: "tool-call-1",
      name: "read",
      type: "toolCall" as const,
    },
  ],
  stopReason: "toolUse",
};

const messages: agentTypes.AgentMessage[] = [
  { content: "Summarize this.", role: "user", timestamp: currentTimeMillis() },
];

const splitTurnPreparation = (
  overrides: Partial<compactionTypes.CompactionPreparation> = {},
): compactionTypes.CompactionPreparation => ({
  fileOps: { edited: new Set(), read: new Set(), written: new Set() },
  firstKeptEntryId: "entry-keep",
  isSplitTurn: true,
  messagesToSummarize: [],
  settings: { enabled: true, keepRecentTokens: 20, reserveTokens: 2000 },
  tokensBefore: 100,
  turnPrefixMessages: messages,
  ...overrides,
});

const compactionSummaryReasoning1Support = {
  createModel,
  messages,
  mockSummaryResponse,
  mockToolCallResponse,
  splitTurnPreparation,
};

export default compactionSummaryReasoning1Support;
