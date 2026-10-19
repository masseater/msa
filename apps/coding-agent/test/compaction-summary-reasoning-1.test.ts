import type { AgentMessage } from "@msa/agent-core";
import {
  type AssistantMessage,
  type Model,
  normalizeContext,
  type TranscriptContext,
} from "@msa/ai";
import { awaited, runTest, currentTimeMillis, toJsonText } from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type CompactionPreparation,
  compact,
  completeSummarization,
  generateSummary,
  generateSummaryWithUsage,
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

const mockToolCallResponse: AssistantMessage = {
  ...mockSummaryResponse,
  content: [
    {
      type: "toolCall" as const,
      id: "tool-call-1",
      name: "read",
      arguments: { path: "README.md" },
    },
  ],
  stopReason: "toolUse",
};

const messages: AgentMessage[] = [
  { role: "user", content: "Summarize this.", timestamp: currentTimeMillis() },
];

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });
  it("uses the provided thinking level for reasoning-capable models", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(
          generateSummaryWithUsage(
            messages,
            createModel(true),
            2000,
            "test-key",
            undefined,
            undefined,
            undefined,
            undefined,
            "medium",
          ),
        );

        expect(result.text).toBe("## Goal\nTest summary");
        expect(result.usage).toEqual(mockSummaryResponse.usage);

        expect(completeSimpleMock).toHaveBeenCalledTimes(1);
        expect(completeSimpleMock.mock.calls[0]?.[2]).toMatchObject({
          reasoning: "medium",
          apiKey: "test-key",
        });
      }),
    ));
  it("preserves the string result from generateSummary", () =>
    runTest(
      awaited(
        expect(generateSummary(messages, createModel(false), 2000, "test-key")).resolves.toBe(
          "## Goal\nTest summary",
        ),
      ),
    ));
  it("uses fresh routing sessions without prompt caching", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(generateSummary(messages, createModel(false), 2000, "test-key"));
        yield* awaited(generateSummary(messages, createModel(false), 2000, "test-key"));

        const requestOptions = completeSimpleMock.mock.calls.map((call) => call[2]);
        expect(requestOptions).toHaveLength(2);
        expect(requestOptions.every((options) => options?.cacheRetention === "none")).toBe(true);

        const sessionIds = requestOptions.map((options) => options?.sessionId);
        expect(sessionIds[0]).not.toBe(sessionIds[1]);
      }),
    ));
  it("honors caller-supplied routing session and tool choice without prompt caching", () =>
    runTest(
      Effect.gen(function* () {
        yield* awaited(
          completeSummarization(
            createModel(false),
            normalizeContext({ systemPrompt: "Summarize", messages: [] }),
            {
              sessionId: "current-routing-session",
              cacheRetention: "long",
              toolChoice: "auto",
            },
          ),
        );

        expect(completeSimpleMock.mock.calls[0]?.[2]).toMatchObject({
          sessionId: "current-routing-session",
          cacheRetention: "none",
          toolChoice: "auto",
        });
      }),
    ));
  it("preserves the previous summary without an empty history request for a split turn", () =>
    runTest(
      Effect.gen(function* () {
        const preparation: CompactionPreparation = {
          firstKeptEntryId: "entry-keep",
          messagesToSummarize: [],
          turnPrefixMessages: messages,
          isSplitTurn: true,
          tokensBefore: 100,
          previousSummary: "previous checkpoint",
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 2000, keepRecentTokens: 20 },
        };

        const result = yield* awaited(compact(preparation, createModel(false), "test-key"));

        expect(completeSimpleMock).toHaveBeenCalledTimes(1);
        expect(result.summary).toContain("previous checkpoint");
        const [call] = completeSimpleMock.mock.calls;
        if (call === undefined) throw new Error("expected completeSimple to be called");
        const requestContext = call[1] as TranscriptContext;
        const prompt = yield* toJsonText(requestContext.messages);

        expect(prompt).toContain("# Conversation\\n[User]: Summarize this.");
        expect(prompt).toContain(
          "# Instructions\\nThe messages above are earlier context from an ongoing conversation.",
        );
      }),
    ));
  it("rejects tool calls from conversation summaries", () =>
    runTest(
      Effect.gen(function* () {
        completeSimpleMock.mockResolvedValueOnce(mockToolCallResponse);

        yield* awaited(
          expect(
            generateSummaryWithUsage(messages, createModel(false), 2000, "test-key"),
          ).rejects.toThrow("Summarization attempted to call a tool"),
        );
      }),
    ));
  it("rejects tool calls from split-turn summaries", () =>
    runTest(
      Effect.gen(function* () {
        completeSimpleMock.mockResolvedValueOnce(mockToolCallResponse);
        const preparation: CompactionPreparation = {
          firstKeptEntryId: "entry-keep",
          messagesToSummarize: [],
          turnPrefixMessages: messages,
          isSplitTurn: true,
          tokensBefore: 100,
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 2000, keepRecentTokens: 20 },
        };

        yield* awaited(
          expect(compact(preparation, createModel(false), "test-key")).rejects.toThrow(
            "Turn prefix summarization attempted to call a tool",
          ),
        );
      }),
    ));
  it("rejects a length-limited history summary", () =>
    runTest(
      Effect.gen(function* () {
        completeSimpleMock.mockResolvedValueOnce({
          ...mockSummaryResponse,
          stopReason: "length",
          content: [{ type: "text" as const, text: "partial" }],
        });

        yield* awaited(
          expect(
            generateSummaryWithUsage(messages, createModel(false), 2000, "test-key"),
          ).rejects.toThrow("generation hit the token cap"),
        );
      }),
    ));
  it("rejects a length-limited split-turn summary", () =>
    runTest(
      Effect.gen(function* () {
        completeSimpleMock.mockResolvedValueOnce({
          ...mockSummaryResponse,
          stopReason: "length",
          content: [{ type: "text" as const, text: "partial" }],
        });
        const preparation: CompactionPreparation = {
          firstKeptEntryId: "entry-keep",
          messagesToSummarize: [],
          turnPrefixMessages: messages,
          isSplitTurn: true,
          tokensBefore: 100,
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: true, reserveTokens: 2000, keepRecentTokens: 20 },
        };

        yield* awaited(
          expect(compact(preparation, createModel(false), "test-key")).rejects.toThrow(
            "generation hit the token cap",
          ),
        );
      }),
    ));
  it("does not set reasoning when thinking is off", () =>
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
    ));
});
