import type aiTypes from "@msa/ai/index.types";

import type cacheStatsTypes from "./cache-stats.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;

const NOISE_FLOOR_TOKENS = 1024;

interface PreviousRequest {
  promptTokens: number;
  modelKey: string;
  timestamp: number;
  reportedCache: boolean;
}

function detectMiss(
  prev: PreviousRequest | undefined,
  message: aiTypes.AssistantMessage,
  models: cacheStatsTypes.ModelPriceSource,
): cacheStatsTypes.CacheMiss | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (
    prev === undefined ||
    promptTokens <= 0 ||
    (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache)
  ) {
    return undefined;
  }

  const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
  if (missedTokens <= NOISE_FLOOR_TOKENS) return undefined;

  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
  const readPerToken =
    usage.cacheRead > 0
      ? usage.cost.cacheRead / usage.cacheRead
      : (models.getModel(message.provider, message.model)?.cost.cacheRead ?? 0) / 1_000_000;

  return {
    idleMs: Math.max(0, message.timestamp - prev.timestamp),
    missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
    missedTokens,
    modelChanged: `${message.provider}/${message.model}` !== prev.modelKey,
  };
}

function asPreviousRequest(
  message: aiTypes.AssistantMessage,
  reportedCache: boolean,
): PreviousRequest | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (promptTokens <= 0) return undefined;
  return {
    modelKey: `${message.provider}/${message.model}`,
    promptTokens,
    reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
    timestamp: message.timestamp,
  };
}

function scan(
  entries: sessionManagerTypes.SessionEntry[],
  models: cacheStatsTypes.ModelPriceSource,
): {
  prev: PreviousRequest | undefined;
  totals: cacheStatsTypes.CacheWasteTotals;
  misses: Map<aiTypes.AssistantMessage, cacheStatsTypes.CacheMiss>;
} {
  let prev: PreviousRequest | undefined;
  const totals: cacheStatsTypes.CacheWasteTotals = { missCount: 0, missedCost: 0, missedTokens: 0 };
  const misses = new Map<aiTypes.AssistantMessage, cacheStatsTypes.CacheMiss>();

  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      prev = undefined;
      continue;
    }
    if (entry.type === "usage" && entry.kind === "cache_warm") {
      const promptTokens = entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite;
      if (promptTokens > 0) {
        prev = {
          modelKey: `${entry.provider}/${entry.model}`,
          promptTokens,
          reportedCache: true,
          timestamp: Date.parse(entry.timestamp),
        };
      }
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      const miss = detectMiss(prev, entry.message, models);
      if (miss !== undefined) {
        totals.missedTokens += miss.missedTokens;
        totals.missedCost += miss.missedCost;
        totals.missCount += 1;
        misses.set(entry.message, miss);
      }
      prev = asPreviousRequest(entry.message, prev?.reportedCache ?? false) ?? prev;
    }
  }
  return { misses, prev, totals };
}

function computeCacheWaste(
  entries: sessionManagerTypes.SessionEntry[],
  models: cacheStatsTypes.ModelPriceSource,
): cacheStatsTypes.CacheWasteTotals {
  return scan(entries, models).totals;
}

function collectCacheMisses(
  entries: sessionManagerTypes.SessionEntry[],
  models: cacheStatsTypes.ModelPriceSource,
): Map<aiTypes.AssistantMessage, cacheStatsTypes.CacheMiss> {
  return scan(entries, models).misses;
}

function detectCacheMiss(
  entries: sessionManagerTypes.SessionEntry[],
  message: aiTypes.AssistantMessage,
  models: cacheStatsTypes.ModelPriceSource,
): cacheStatsTypes.CacheMiss | undefined {
  return detectMiss(scan(entries, models).prev, message, models);
}

const cacheStats = {
  CACHE_TTL_MS,
  collectCacheMisses,
  computeCacheWaste,
  detectCacheMiss,
};

export default cacheStats;
