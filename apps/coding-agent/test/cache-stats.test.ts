import type aiTypes from "@msa/ai/index.types";
import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import cacheStats from "../src/core/cache-stats.ts";
import type cacheStatsTypes from "../src/core/cache-stats.types.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";

const { collectCacheMisses, computeCacheWaste, detectCacheMiss } = cacheStats;

const zeroCost = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 };

const models: cacheStatsTypes.ModelPriceSource = {
  getModel: () => ({ cost: { cacheRead: 0.3 } }),
};

function assistant(options: {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: Partial<typeof zeroCost>;
  model?: string;
  timestamp?: number;
}): aiTypes.AssistantMessage {
  return {
    api: "anthropic-messages",
    content: [],
    model: options.model ?? "test-model",
    provider: "test",
    role: "assistant",
    stopReason: "stop",
    timestamp: options.timestamp ?? 0,
    usage: {
      cacheRead: options.cacheRead ?? 0,
      cacheWrite: options.cacheWrite ?? 0,
      cost: { ...zeroCost, ...options.cost },
      input: options.input ?? 0,
      output: 10,
      totalTokens: 0,
    },
  } as aiTypes.AssistantMessage;
}

function entry(message: aiTypes.AssistantMessage): sessionManagerTypes.SessionEntry {
  return {
    id: "x",
    message,
    parentId: null,
    timestamp: "",
    type: "message",
  } as sessionManagerTypes.SessionEntry;
}

function usageEntry(kind: string, timestamp: number): sessionManagerTypes.SessionEntry {
  return {
    id: `usage-${kind}`,
    kind,
    model: "test-model",
    parentId: null,
    provider: "test",
    timestamp: DateTime.formatIso(DateTime.makeUnsafe(timestamp)),
    type: "usage",
    usage: {
      cacheRead: 100_000,
      cacheWrite: 0,
      cost: zeroCost,
      input: 0,
      output: 0,
      totalTokens: 100_000,
    },
  };
}

const turn1 = assistant({ cacheWrite: 100_000, cost: { cacheWrite: 0.375 }, timestamp: 0 });

const turn2 = assistant({
  cacheRead: 100_000,
  cacheWrite: 5_000,
  cost: { cacheRead: 0.03, cacheWrite: 0.019 },
  timestamp: 60_000,
});

const accumulatesMissedTokensAndCostAcrossTurns = () => {
  const turn3 = assistant({
    cacheWrite: 110_000,
    cost: { cacheWrite: 0.4125 },
    timestamp: 120_000,
  });
  const totals = computeCacheWaste([entry(turn1), entry(turn2), entry(turn3)], models);
  expect(totals.missedTokens).toBe(105_000);

  expect(totals.missedCost).toBeCloseTo(0.36225, 5);
};

const countsNothingForHealthySessions = () => {
  const totals = computeCacheWaste([entry(turn1), entry(turn2)], models);
  expect(totals.missedTokens).toBe(0);
  expect(totals.missedCost).toBe(0);
};

const skipsTheTurnAfterACompactionReset = () => {
  const reset = {
    id: "c",
    parentId: null,
    timestamp: "",
    type: "compaction",
  } as sessionManagerTypes.SessionEntry;
  const afterReset = assistant({ cacheWrite: 20_000, cost: { cacheWrite: 0.075 } });
  const totals = computeCacheWaste([entry(turn1), reset, entry(afterReset)], models);
  expect(totals.missedTokens).toBe(0);
};

const countsMissesCausedByModelSwitches = () => {
  const otherModel = assistant({
    cacheWrite: 100_000,
    cost: { cacheWrite: 0.375 },
    model: "other-model",
  });
  const totals = computeCacheWaste([entry(turn1), entry(otherModel)], models);
  expect(totals.missedTokens).toBe(100_000);
  expect(totals.missCount).toBe(1);
};

const skipsProvidersThatReportNoCacheActivity = () => {
  const a = assistant({ input: 100_000 });
  const b = assistant({ input: 110_000 });
  const totals = computeCacheWaste([entry(a), entry(b)], models);
  expect(totals.missedTokens).toBe(0);
};

describe("computeCacheWaste", () => {
  it("accumulates missed tokens and cost across turns", accumulatesMissedTokensAndCostAcrossTurns);

  it("counts nothing for healthy sessions", countsNothingForHealthySessions);

  it("skips the turn after a compaction reset", skipsTheTurnAfterACompactionReset);

  it("counts misses caused by model switches", countsMissesCausedByModelSwitches);

  it("skips providers that report no cache activity", skipsProvidersThatReportNoCacheActivity);
});

const mapsCountedMissesToTheirAssistantMessages = () => {
  const missTurn = assistant({
    cacheWrite: 110_000,
    cost: { cacheWrite: 0.4125 },
    timestamp: 120_000,
  });
  const misses = collectCacheMisses([entry(turn1), entry(turn2), entry(missTurn)], models);
  expect(misses.size).toBe(1);
  expect(misses.get(missTurn)?.missedTokens).toBe(105_000);
};

describe("collectCacheMisses", () => {
  it(
    "maps counted misses to their assistant messages by reference",
    mapsCountedMissesToTheirAssistantMessages,
  );
});

const detectsAMissOnAJustCompleted = () => {
  const missMessage = assistant({
    cacheWrite: 110_000,
    cost: { cacheWrite: 0.4125 },
    timestamp: 600_000,
  });
  const miss = detectCacheMiss([entry(turn1), entry(turn2)], missMessage, models);
  expect(miss).toBeDefined();
  expect(miss?.missedTokens).toBe(105_000);
  expect(miss?.missedCost).toBeCloseTo(0.36225, 5);

  expect(miss?.idleMs).toBe(540_000);
  expect(miss?.modelChanged).toBe(false);
};

const flagsModelSwitchesOnDetectedMisses = () => {
  const otherModel = assistant({
    cacheWrite: 110_000,
    cost: { cacheWrite: 0.4125 },
    model: "other-model",
    timestamp: 120_000,
  });
  const miss = detectCacheMiss([entry(turn1), entry(turn2)], otherModel, models);
  expect(miss?.missedTokens).toBe(105_000);
  expect(miss?.modelChanged).toBe(true);
};

const usesOnlyCacheWarmUsageEntriesAs = () => {
  const missMessage = assistant({
    cacheWrite: 110_000,
    cost: { cacheWrite: 0.4125 },
    timestamp: 600_000,
  });

  const afterCacheWarm = detectCacheMiss(
    [entry(turn1), usageEntry("cache_warm", 500_000)],
    missMessage,
    models,
  );
  const afterOtherUsage = detectCacheMiss(
    [entry(turn1), usageEntry("custom_operation", 500_000)],
    missMessage,
    models,
  );

  expect(afterCacheWarm?.idleMs).toBe(100_000);
  expect(afterOtherUsage?.idleMs).toBe(600_000);
};

const returnsUndefinedForHealthyTurns = () => {
  const healthy = assistant({
    cacheRead: 105_000,
    cacheWrite: 2_000,
    cost: { cacheRead: 0.0315, cacheWrite: 0.0075 },
    timestamp: 120_000,
  });
  expect(detectCacheMiss([entry(turn1), entry(turn2)], healthy, models)).toBeUndefined();
};

const returnsUndefinedForTheFirstTurnOf = () => {
  expect(detectCacheMiss([], turn1, models)).toBeUndefined();
};

describe("detectCacheMiss", () => {
  it("detects a miss on a just-completed message with idle time", detectsAMissOnAJustCompleted);

  it("flags model switches on detected misses", flagsModelSwitchesOnDetectedMisses);

  it("uses only cache-warm usage entries as cache refreshes", usesOnlyCacheWarmUsageEntriesAs);

  it("returns undefined for healthy turns", returnsUndefinedForHealthyTurns);

  it("returns undefined for the first turn of a session", returnsUndefinedForTheFirstTurnOf);
});
