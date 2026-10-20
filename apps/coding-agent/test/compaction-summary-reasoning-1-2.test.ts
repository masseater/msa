import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type CompactionPreparation,
  compact,
  generateSummary,
  generateSummaryWithUsage,
} from "../src/core/compaction/index.ts";
import compactionSummaryReasoning1Support from "./compaction-summary-reasoning-1-support.ts";

const { createModel } = compactionSummaryReasoning1Support;

const { awaited, currentTimeMillis, runTest, toJsonText } = testing;

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

const preservesThePreviousSummaryWithoutAnEmpty = () =>
  runTest(
    Effect.gen(function* () {
      const preparation: CompactionPreparation = {
        fileOps: { edited: new Set(), read: new Set(), written: new Set() },
        firstKeptEntryId: "entry-keep",
        isSplitTurn: true,
        messagesToSummarize: [],
        previousSummary: "previous checkpoint",
        settings: { enabled: true, keepRecentTokens: 20, reserveTokens: 2000 },
        tokensBefore: 100,
        turnPrefixMessages: messages,
      };

      const result = yield* awaited(compact(preparation, createModel(false), "test-key"));

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      expect(result.summary).toContain("previous checkpoint");
      const [call] = completeSimpleMock.mock.calls;
      if (call === undefined) throw new Error("expected completeSimple to be called");
      const requestContext = call[1] as aiTypes.TranscriptContext;
      const prompt = yield* toJsonText(requestContext.messages);

      expect(prompt).toContain("# Conversation\\n[User]: Summarize this.");
      expect(prompt).toContain(
        "# Instructions\\nThe messages above are earlier context from an ongoing conversation.",
      );
    }),
  );

const rejectsToolCallsFromConversationSummaries = () =>
  runTest(
    Effect.gen(function* () {
      completeSimpleMock.mockResolvedValueOnce(mockToolCallResponse);

      yield* awaited(
        expect(
          generateSummaryWithUsage(messages, createModel(false), 2000, "test-key"),
        ).rejects.toThrow("Summarization attempted to call a tool"),
      );
    }),
  );

const rejectsToolCallsFromSplitTurnSummaries = () =>
  runTest(
    Effect.gen(function* () {
      completeSimpleMock.mockResolvedValueOnce(mockToolCallResponse);
      const preparation: CompactionPreparation = {
        fileOps: { edited: new Set(), read: new Set(), written: new Set() },
        firstKeptEntryId: "entry-keep",
        isSplitTurn: true,
        messagesToSummarize: [],
        settings: { enabled: true, keepRecentTokens: 20, reserveTokens: 2000 },
        tokensBefore: 100,
        turnPrefixMessages: messages,
      };

      yield* awaited(
        expect(compact(preparation, createModel(false), "test-key")).rejects.toThrow(
          "Turn prefix summarization attempted to call a tool",
        ),
      );
    }),
  );

const rejectsALengthLimitedHistorySummary = () =>
  runTest(
    Effect.gen(function* () {
      completeSimpleMock.mockResolvedValueOnce({
        ...mockSummaryResponse,
        content: [{ text: "partial", type: "text" as const }],
        stopReason: "length",
      });

      yield* awaited(
        expect(
          generateSummaryWithUsage(messages, createModel(false), 2000, "test-key"),
        ).rejects.toThrow("generation hit the token cap"),
      );
    }),
  );

const rejectsALengthLimitedSplitTurnSummary = () =>
  runTest(
    Effect.gen(function* () {
      completeSimpleMock.mockResolvedValueOnce({
        ...mockSummaryResponse,
        content: [{ text: "partial", type: "text" as const }],
        stopReason: "length",
      });
      const preparation: CompactionPreparation = {
        fileOps: { edited: new Set(), read: new Set(), written: new Set() },
        firstKeptEntryId: "entry-keep",
        isSplitTurn: true,
        messagesToSummarize: [],
        settings: { enabled: true, keepRecentTokens: 20, reserveTokens: 2000 },
        tokensBefore: 100,
        turnPrefixMessages: messages,
      };

      yield* awaited(
        expect(compact(preparation, createModel(false), "test-key")).rejects.toThrow(
          "generation hit the token cap",
        ),
      );
    }),
  );

const doesNotSetReasoningWhenThinkingIs = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(
        generateSummary(
          messages,
          createModel(true),
          2000,
          "test-key",
          undefined,
          undefined,
          undefined,
          undefined,
          "off",
        ),
      );

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      expect(completeSimpleMock.mock.calls[0]?.[2]).toMatchObject({
        apiKey: "test-key",
      });
      expect(completeSimpleMock.mock.calls[0]?.[2]).not.toHaveProperty("reasoning");
    }),
  );

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });

  it(
    "preserves the previous summary without an empty history request for a split turn",
    preservesThePreviousSummaryWithoutAnEmpty,
  );

  it("rejects tool calls from conversation summaries", rejectsToolCallsFromConversationSummaries);

  it("rejects tool calls from split-turn summaries", rejectsToolCallsFromSplitTurnSummaries);

  it("rejects a length-limited history summary", rejectsALengthLimitedHistorySummary);

  it("rejects a length-limited split-turn summary", rejectsALengthLimitedSplitTurnSummary);
});

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });

  it("does not set reasoning when thinking is off", doesNotSetReasoningWhenThinkingIs);
});
