import type { AgentMessage } from "@msa/agent-core";
import { type AssistantMessage, type Model } from "@msa/ai";
import { awaited, runTest, currentTimeMillis } from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type CompactionPreparation,
  compact,
  generateSummary,
} from "../src/core/compaction/index.ts";

const { completeSimpleMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
}));

vi.mock("@msa/ai/compat", (importOriginal) =>
  runTest(
    Effect.gen(function* () {
      const actual = yield* awaited(importOriginal<typeof import("@msa/ai/compat")>());
      return yield* awaited({
        ...actual,
        completeSimple: completeSimpleMock,
      });
    }),
  ),
);

function createModel(
  reasoning: boolean,
  maxTokens = 8192,
  compat?: Model<"anthropic-messages">["compat"],
): Model<"anthropic-messages"> {
  return {
    id: reasoning ? "reasoning-model" : "non-reasoning-model",
    name: reasoning ? "Reasoning Model" : "Non-reasoning Model",
    api: "anthropic-messages" as const,
    provider: "anthropic-api",
    baseUrl: "https://api.anthropic.com",
    reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens,
    ...(compat === undefined ? {} : { compat }),
  };
}

const mockSummaryResponse: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text" as const, text: "## Goal\nTest summary" }],
  api: "anthropic-messages" as const,
  provider: "anthropic-api",
  model: "claude-sonnet-4-5",
  usage: {
    input: 10,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 20,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: currentTimeMillis(),
};
const messages: AgentMessage[] = [
  { role: "user", content: "Summarize this.", timestamp: currentTimeMillis() },
];

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });
  it("does not set reasoning for non-reasoning models", () =>
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
    ));
  it("leaves Anthropic refusal fallback handling to msa-ai model metadata", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(
          generateSummary(
            messages,
            createModel(true, 8192, {
              allowedFallbackModels: [
                {
                  provider: "anthropic-api",
                  model: "claude-opus-4-8",
                  cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
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
    ));
  it("does not set Anthropic refusal fallback for models without allowed fallback targets", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(generateSummary(messages, createModel(true), 2000, "test-key"));

        expect(completeSimpleMock).toHaveBeenCalledTimes(1);
        expect(completeSimpleMock.mock.calls[0]?.[2]).not.toHaveProperty("refusalFallbacks");
      }),
    ));
  it("clamps compaction summary maxTokens to the model output cap", () =>
    runTest(
      Effect.gen(function* () {
        const preparation: CompactionPreparation = {
          firstKeptEntryId: "entry-keep",
          messagesToSummarize: messages,
          turnPrefixMessages: messages,
          isSplitTurn: true,
          tokensBefore: 600000,
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 500000, keepRecentTokens: 20000 },
        };

        const result = yield* awaited(compact(preparation, createModel(false, 128000), "test-key"));

        expect(result.usage).toEqual({
          ...mockSummaryResponse.usage,
          input: 20,
          output: 20,
          totalTokens: 40,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        });
        expect(completeSimpleMock.mock.calls.map((call) => call[2]?.maxTokens)).toEqual([
          128000, 128000,
        ]);
      }),
    ));
});
