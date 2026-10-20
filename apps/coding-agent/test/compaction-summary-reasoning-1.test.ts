import type { AgentMessage } from "@msa/agent-core";
import { type AssistantMessage, normalizeContext } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  completeSummarization,
  generateSummary,
  generateSummaryWithUsage,
} from "../src/core/compaction/index.ts";
import compactionSummaryReasoning1Support from "./compaction-summary-reasoning-1-support.ts";

const { createModel } = compactionSummaryReasoning1Support;

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
        completeSimple: completeSimpleMock,
      });
    }),
  ),
);

const mockSummaryResponse: AssistantMessage = {
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

const messages: AgentMessage[] = [
  { content: "Summarize this.", role: "user", timestamp: currentTimeMillis() },
];

const usesTheProvidedThinkingLevelForReasoning = () =>
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
        apiKey: "test-key",
        reasoning: "medium",
      });
    }),
  );

const preservesTheStringResultFromGeneratesummary = () =>
  runTest(
    awaited(
      expect(generateSummary(messages, createModel(false), 2000, "test-key")).resolves.toBe(
        "## Goal\nTest summary",
      ),
    ),
  );

const usesFreshRoutingSessionsWithoutPromptCaching = () =>
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
  );

const honorsCallerSuppliedRoutingSessionAndTool = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(
        completeSummarization(
          createModel(false),
          normalizeContext({ messages: [], systemPrompt: "Summarize" }),
          {
            cacheRetention: "long",
            sessionId: "current-routing-session",
            toolChoice: "auto",
          },
        ),
      );

      expect(completeSimpleMock.mock.calls[0]?.[2]).toMatchObject({
        cacheRetention: "none",
        sessionId: "current-routing-session",
        toolChoice: "auto",
      });
    }),
  );

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });

  it(
    "uses the provided thinking level for reasoning-capable models",
    usesTheProvidedThinkingLevelForReasoning,
  );

  it(
    "preserves the string result from generateSummary",
    preservesTheStringResultFromGeneratesummary,
  );
});

describe("generateSummary reasoning options", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue(mockSummaryResponse);
  });

  it(
    "uses fresh routing sessions without prompt caching",
    usesFreshRoutingSessionsWithoutPromptCaching,
  );

  it(
    "honors caller-supplied routing session and tool choice without prompt caching",
    honorsCallerSuppliedRoutingSessionAndTool,
  );
});
