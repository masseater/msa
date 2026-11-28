import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import compactionSummaryReasoning1Support from "./compaction-summary-reasoning-1-support.ts";

const { createModel, messages, mockSummaryResponse, splitTurnPreparation } =
  compactionSummaryReasoning1Support;

const { compact, generateSummary } = compaction;

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

const noopCases = [
  {
    absent: "reasoning",
    model: createModel(false),
    name: "does not set reasoning for non-reasoning models",
    thinking: "medium",
  },
  {
    absent: "reasoning",
    model: createModel(true),
    name: "does not set reasoning when thinking is off",
    thinking: "off",
  },
  {
    absent: "refusalFallbacks",
    model: createModel(true, 8192, {
      allowedFallbackModels: [
        {
          cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
          model: "claude-opus-4-8",
          provider: "anthropic-api",
        },
      ],
    }),
    name: "leaves Anthropic refusal fallback handling to msa-ai model metadata",
    thinking: undefined,
  },
  {
    absent: "refusalFallbacks",
    model: createModel(true),
    name: "does not set Anthropic refusal fallback for models without allowed fallback targets",
    thinking: undefined,
  },
] as const;

const requestsWithout = ({ absent, model, thinking }: (typeof noopCases)[number]) =>
  Effect.gen(function* () {
    yield* awaited(
      generateSummary(
        messages,
        model,
        2000,
        "test-key",
        undefined,
        undefined,
        undefined,
        undefined,
        thinking,
      ),
    );

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(completeSimpleMock.mock.calls[0]?.[2]).toMatchObject({ apiKey: "test-key" });
    expect(completeSimpleMock.mock.calls[0]?.[2]).not.toHaveProperty(absent);
  });

const clampsCompactionSummaryMaxtokensToTheModel = () =>
  runTest(
    Effect.gen(function* () {
      const preparation = splitTurnPreparation({
        messagesToSummarize: messages,
        settings: { enabled: true, keepRecentTokens: 20000, reserveTokens: 500000 },
        tokensBefore: 600000,
      });

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
  it.each(noopCases)("$name", (testCase) => runTest(requestsWithout(testCase)));
  it(
    "clamps compaction summary maxTokens to the model output cap",
    clampsCompactionSummaryMaxtokensToTheModel,
  );
});
