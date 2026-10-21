import type agentSessionTypes from "../../core/agent-session.types.ts";
import type cacheStatsTypes from "../../core/cache-stats.types.ts";
import type cacheWarmerTypes from "../../core/cache-warmer.types.ts";
import type contextBreakdownTypes from "../../core/context-breakdown.types.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type usageTotalsTypes from "../../core/usage-totals.types.ts";

declare namespace sessionInfoTypes {
  type SessionInfo = {
    stats: agentSessionTypes.SessionStats;
    sessionName: string | undefined;
    cacheWaste: cacheStatsTypes.CacheWasteTotals;
    usageBreakdown: readonly usageTotalsTypes.UsageCostBreakdownEntry[];
    cacheWarmingMode: settingsManagerTypes.CacheWarmingMode;
    cacheWarmingStatus: cacheWarmerTypes.CacheWarmingStatus | undefined;
    selectedModelKey: string;
    contextBreakdown: contextBreakdownTypes.ContextBreakdown;
    contextWindow: number | undefined;
    telemetry: string | undefined;
  };
}

export type { sessionInfoTypes as default };
