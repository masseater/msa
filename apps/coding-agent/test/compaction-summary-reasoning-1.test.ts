import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import compactionSummaryReasoning1Support from "./compaction-summary-reasoning-1-support.ts";

const { completeSummarization, generateSummary, generateSummaryWithUsage } = compaction;

const { normalizeContext } = ai;

const { createModel, messages, mockSummaryResponse } = compactionSummaryReasoning1Support;

const { awaited, runTest } = testing;

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
