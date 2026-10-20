import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type CompactionPreparation,
  compact,
  generateSummary,
} from "../src/core/compaction/index.ts";

const { awaited, currentTimeMillis, runTest } = testing;

const { completeSimpleMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
}));

vi.mock("@msa/ai/compat", (importOriginal) =>
  testing.runTest(
    Effect.gen(function* () {
      const actual = yield* testing.awaited(importOriginal<typeof import("@msa/ai/compat")>());
      return yield* testing.awaited({
        ...actual,
        default: { ...actual.default, completeSimple: completeSimpleMock },
      });
    }),
  ),
);

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
const messages: agentTypes.AgentMessage[] = [
  { content: "Summarize this.", role: "user", timestamp: currentTimeMillis() },
];

const doesNotSetReasoningForNonReasoning = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(
        generateSummary(
          messages,
          createModel(false),
          2000,
          "test-key",
          undefined,
          undefined,
          undefined,
          undefined,
          "medium",
        ),
      );

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      expect(completeSimpleMock.mock.calls[0]?.[2]).toMatchObject({
        apiKey: "test-key",
      });
      expect(completeSimpleMock.mock.calls[0]?.[2]).not.toHaveProperty("reasoning");
    }),
  );

const leavesAnthropicRefusalFallbackHandlingToMsa = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(
        generateSummary(
          messages,
          createModel(true, 8192, {
            allowedFallbackModels: [
              {
                cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
                model: "claude-opus-4-8",
                provider: "anthropic-api",
              },
            ],
          }),
          2000,
          "test-key",
        ),
      );

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      expect(completeSimpleMock.mock.calls[0]?.[2]).not.toHaveProperty("refusalFallbacks");
    }),
  );

const doesNotSetAnthropicRefusalFallbackFor = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(generateSummary(messages, createModel(true), 2000, "test-key"));

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      expect(completeSimpleMock.mock.calls[0]?.[2]).not.toHaveProperty("refusalFallbacks");
    }),
  );

const clampsCompactionSummaryMaxtokensToTheModel = () =>
  runTest(
    Effect.gen(function* () {
      const preparation: CompactionPreparation = {
        fileOps: { edited: new Set(), read: new Set(), written: new Set() },
        firstKeptEntryId: "entry-keep",
        isSplitTurn: true,
        messagesToSummarize: messages,
        settings: { enabled: true, keepRecentTokens: 20000, reserveTokens: 500000 },
        tokensBefore: 600000,
        turnPrefixMessages: messages,
      };

      const result = yield* awaited(compact(preparation, createModel(false, 128000), "test-key"));

      expect(result.usage).toEqual({
        ...mockSummaryResponse.usage,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 20,
        output: 20,
        totalTokens: 40,
      });
      expect(completeSimpleMock.mock.calls.map((call) => call[2]?.maxTokens)).toEqual([
        128000, 128000,
      ]);
    }),
  );

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });
  it("does not set reasoning for non-reasoning models", doesNotSetReasoningForNonReasoning);
  it(
    "leaves Anthropic refusal fallback handling to msa-ai model metadata",
    leavesAnthropicRefusalFallbackHandlingToMsa,
  );
  it(
    "does not set Anthropic refusal fallback for models without allowed fallback targets",
    doesNotSetAnthropicRefusalFallbackFor,
  );
  it(
    "clamps compaction summary maxTokens to the model output cap",
    clampsCompactionSummaryMaxtokensToTheModel,
  );
});
