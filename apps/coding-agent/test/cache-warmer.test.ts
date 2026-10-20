import type aiTypes from "@msa/ai/index.types";
import all from "@msa/ai/providers/all";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import cacheWarmerSupportModule from "../src/core/cache-warmer-support.ts";
import cacheWarmerSupport from "./cache-warmer-support.ts";

const { getCacheWarmingDelayMs, getPromptCacheTtlMs, isReplayable } = cacheWarmerSupportModule;

const { getBuiltinModel } = all;

const { adaptiveModel, budgetModel, current, fakeRuntime, request, warmUsage } = cacheWarmerSupport;

const { abortController, awaited, runTest } = testing;

const openaiModel: aiTypes.Model<aiTypes.Api> = {
  ...getBuiltinModel("openai", "gpt-5"),
  promptCache: { long: 86_400, short: 300 },
};

const { promptCache: _adaptivePromptCache, ...unknownModel }: aiTypes.Model<aiTypes.Api> =
  adaptiveModel;

afterEach(() => vi.useRealTimers());

const derivesEligibilityAndTimingFromRetentionAnd = () => {
  expect([
    getPromptCacheTtlMs(adaptiveModel, undefined),
    getPromptCacheTtlMs(adaptiveModel, { cacheRetention: "long" }),
    getPromptCacheTtlMs(adaptiveModel, { cacheRetention: "none" }),
    getPromptCacheTtlMs(adaptiveModel, { env: { MSA_CACHE_RETENTION: "long" } }),
    getPromptCacheTtlMs(openaiModel, { cacheRetention: "long" }),
    getPromptCacheTtlMs(unknownModel, undefined),
  ]).toEqual([300_000, 3_600_000, undefined, 3_600_000, 86_400_000, undefined]);
  expect([
    getCacheWarmingDelayMs(300_000),
    getCacheWarmingDelayMs(60_000),
    getCacheWarmingDelayMs(10_000),
  ]).toEqual([270_000, 50_000, undefined]);
  expect([
    isReplayable(budgetModel, { reasoning: "medium" }),
    isReplayable(budgetModel, undefined),
    isReplayable(adaptiveModel, { reasoning: "medium" }),
    isReplayable(openaiModel, { reasoning: "medium" }),
  ]).toEqual([false, true, true, true]);
};

describe("cache warming", () => {
  it(
    "derives eligibility and timing from retention and provider behavior",
    derivesEligibilityAndTimingFromRetentionAnd,
  );
});

const replaysProfitableRequestsAndPreservesOptionsAcross = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      vi.useFakeTimers();
      const { warmer, calls, events, appendUsage, warmedEntries } = fakeRuntime();
      const signal = abortController().signal;
      const transformHeaders = () => effectRunPromise(awaited({}));

      warmer.start(
        request(adaptiveModel, { reasoning: "high", sessionId: "s", signal, transformHeaders }),
        current,
      );
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));

      expect(calls[0]).toMatchObject({
        model: adaptiveModel,
        options: {
          maxRetries: 0,
          maxTokens: 1,
          reasoning: "high",
          sessionId: "s",
          transformHeaders,
        },
      });
      expect(calls[0]?.options?.signal).not.toBe(signal);
      expect(events[0]).toMatchObject({
        action: "warm",
        continuationProbability: 1,
        type: "cache_warming_decision" as const,
      });
      expect(events[0]?.missCost).toBeCloseTo(0.575);
      expect(events[0]?.warmCost).toBeCloseTo(0.050025);
      expect(appendUsage).toHaveBeenCalledWith(
        "cache_warm",
        adaptiveModel.provider,
        adaptiveModel.id,
        warmUsage,
        undefined,
      );
      expect(warmedEntries).toEqual([appendUsage.mock.results[0]?.value]);

      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(calls).toHaveLength(2);
      warmer.cancel();
    }),
  );

describe("cache warming", () => {
  it(
    "replays profitable requests and preserves options across repeated refreshes",
    replaysProfitableRequestsAndPreservesOptionsAcross,
  );
});
