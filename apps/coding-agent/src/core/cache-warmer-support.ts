import type aiTypes from "@msa/ai/index.types";
import providerEnv from "@msa/ai/utils/provider-env";

import type cacheWarmerTypes from "./cache-warmer.types.ts";
import platform from "./platform.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { nowMs } = platform;
const { getProviderEnvValue } = providerEnv;
const CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS = 0.05;
function getCacheWarmingDelayMs(ttlMs: number): number | undefined {
  if (ttlMs <= 10_000) return undefined;
  return Math.max(1, Math.floor(Math.min(ttlMs * 0.9, ttlMs - 10_000)));
}
function getPromptCacheTtlMs(
  model: aiTypes.Model<aiTypes.Api>,
  options: aiTypes.SimpleStreamOptions | undefined,
): number | undefined {
  const retention =
    options?.cacheRetention ??
    (getProviderEnvValue("MSA_CACHE_RETENTION", options?.env) === "long" ? "long" : "short");
  if (retention === "none") return undefined;
  const seconds = model.promptCache?.[retention];
  return seconds === undefined ? undefined : seconds * 1000;
}
function isReplayable(
  model: aiTypes.Model<aiTypes.Api>,
  options: aiTypes.SimpleStreamOptions | undefined,
): boolean {
  if (options?.reasoning === undefined || model.api !== "anthropic-messages") return true;
  return (model as aiTypes.Model<"anthropic-messages">).compat?.forceAdaptiveThinking === true;
}
function formatDollars(value: number): string {
  return value < 0 ? `-$${Math.abs(value).toFixed(3)}` : `$${value.toFixed(3)}`;
}
function formatCacheWarmingEconomics(decision: cacheWarmerTypes.CacheWarmingDecision): string {
  if (!decision.economicsAvailable) return "cache economics unavailable";
  const probability = Math.round(decision.continuationProbability * 100);
  const probabilityText =
    decision.phase === "streaming"
      ? `${probability}% continuation probability while agent is running`
      : `${probability}% continuation probability`;
  const comparison = decision.action === "warm" ? ">=" : "<";
  return `${probabilityText}, expected savings ${formatDollars(decision.expectedSavings)} ${comparison} $${CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS.toFixed(3)}`;
}
function formatCacheWarmingDecisionTime(nextWarmAt: number | undefined, now: number): string {
  if (nextWarmAt === undefined || nextWarmAt <= now) return "Decision now";
  let remainingSeconds = Math.ceil((nextWarmAt - now) / 1000);
  const hours = Math.floor(remainingSeconds / 3600);
  remainingSeconds %= 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return `Decision in ${parts.join(" ")}`;
}
function formatCacheWarmingStatus(
  status: cacheWarmerTypes.CacheWarmingStatus,
  now = nowMs(),
): string {
  const decision = status.decision;
  if (
    decision === undefined ||
    (status.state === "inactive" &&
      !decision.economicsAvailable &&
      status.extensionOverride !== true)
  ) {
    return `Inactive (${status.reason ?? "unknown reason"})`;
  }
  const details =
    status.extensionOverride === true
      ? `extension override, ${formatCacheWarmingEconomics(decision)}`
      : `${formatCacheWarmingEconomics(decision)} -> ${decision.action}`;
  if (status.state === "inactive") return `Stopped (${details})`;
  if (status.state === "refreshing") return `Warming cache (${details})`;
  return `${formatCacheWarmingDecisionTime(status.nextWarmAt, now)} (${details})`;
}
function formatCacheWarmingUsage(entry: sessionManagerTypes.UsageEntry): string {
  const note = entry.note !== undefined && entry.note !== "" ? ` (${entry.note})` : "";
  const cost = entry.usage.cost.total.toFixed(6).replace(/(\.\d{3}\d*?)0+$/u, "$1");
  return `Cache warmed${note}: $${cost}`;
}

const cacheWarmerSupport = {
  CACHE_WARMING_MINIMUM_EXPECTED_SAVINGS,
  formatCacheWarmingStatus,
  formatCacheWarmingUsage,
  getCacheWarmingDelayMs,
  getPromptCacheTtlMs,
  isReplayable,
};

export default cacheWarmerSupport;
