import { type Api, type Model } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type CacheWarmingDecision,
  formatCacheWarmingStatus,
  formatCacheWarmingUsage,
} from "../src/core/cache-warmer.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import cacheWarmerSupport from "./cache-warmer-support.ts";

const {
  adaptiveModel,
  branchWithPrompt,
  budgetModel,
  current,
  fakeRuntime,
  request,
  response,
  warmUsage,
} = cacheWarmerSupport;

const { awaited, gate, runTest } = testing;

const { promptCache: _adaptivePromptCache, ...unknownModel }: Model<Api> = adaptiveModel;

afterEach(() => vi.useRealTimers());

const formatsStatusAndUsageEntries = () => {
  const decision: CacheWarmingDecision = {
    action: "warm",
    continuationProbability: 0.6,
    economicsAvailable: true,
    expectedSavings: 0.36,
    missCost: 0.621,
    phase: "idle",
    warmCost: 0.013,
  };
  expect(formatCacheWarmingStatus({ decision, nextWarmAt: 222_000, state: "scheduled" }, 0)).toBe(
    "Decision in 3m 42s (60% continuation probability, expected savings $0.360 >= $0.050 -> warm)",
  );
  const usage = {
    ...warmUsage,
    cost: {
      cacheRead: 0.02940725,
      cacheWrite: 0,
      input: 0.00004,
      output: 0.00005,
      total: 0.02949725,
    },
  };
  const entry = SessionManager.inMemory().appendUsage(
    "cache_warm",
    adaptiveModel.provider,
    adaptiveModel.id,
    usage,
    "extension override",
  );
  expect(formatCacheWarmingUsage(entry)).toBe("Cache warmed (extension override): $0.029497");
};

const stopsForUnsupportedRequestsContextChangesAnd = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const unsupported = fakeRuntime();
      unsupported.state.mode = "off";
      unsupported.warmer.start(request(), current);
      expect(unsupported.warmer.status.reason).toBe("cache warming disabled");
      unsupported.state.mode = "idle";
      unsupported.warmer.start(request(unknownModel), current);
      expect(unsupported.warmer.status.reason).toBe("cache lifetime unavailable");
      unsupported.warmer.start(request(budgetModel, { reasoning: "high" }), current);
      expect(unsupported.warmer.status.reason).toBe("request cannot be replayed safely");

      let stillCurrent = true;
      unsupported.warmer.start(request(), () => stillCurrent);
      stillCurrent = false;
      expect(unsupported.warmer.status.reason).toBe("conversation context changed");
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(unsupported.calls).toHaveLength(0);

      unsupported.warmer.start(request(), current);
      unsupported.state.mode = "off";
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(unsupported.calls).toHaveLength(0);

      const streaming = fakeRuntime({ branch: branchWithPrompt(400_000), mode: "streaming" });
      streaming.warmer.start(request(), current);
      streaming.warmer.onAgentSettled();
      expect(streaming.warmer.status.reason).toBe("agent run settled");
    }),
  );

describe("cache warming", () => {
  it(
    "stops for unsupported requests, context changes, and mode changes",
    stopsForUnsupportedRequestsContextChangesAnd,
  );
});

const abortsReplacedRequestsAndDoesNotRecord = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      vi.useFakeTimers();
      const held = gate();
      const pending = fakeRuntime({
        result: (model) => held.then(() => response(model)),
      });
      pending.warmer.start(request(), current);
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      pending.warmer.start(request(), current);
      expect(pending.calls[0]?.options?.signal?.aborted).toBe(true);
      held.release();
      pending.warmer.cancel();
      yield* awaited(vi.advanceTimersByTimeAsync(600_000));
      expect(pending.calls).toHaveLength(1);

      const failed = fakeRuntime({
        result: (model) => effectRunPromise(awaited(response(model, "error"))),
      });
      failed.warmer.start(request(), current);
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(failed.appendUsage).not.toHaveBeenCalled();
      failed.warmer.cancel();
    }),
  );

describe("cache warming", () => {
  it(
    "aborts replaced requests and does not record failed refreshes",
    abortsReplacedRequestsAndDoesNotRecord,
  );

  it("formats status and usage entries", formatsStatusAndUsageEntries);
});
