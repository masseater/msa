import type aiTypes from "@msa/ai/index.types";

import type CacheWarmerClass from "./cache-warmer.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace cacheWarmerTypes {
  type CacheWarmingAction = "warm" | "stop";

  interface CacheWarmingDecision {
    phase: "streaming" | "idle";
    warmCost: number;
    missCost: number;
    continuationProbability: number;
    expectedSavings: number;
    economicsAvailable: boolean;
    action: CacheWarmingAction;
  }

  interface CacheWarmingDecisionEvent extends Pick<
    CacheWarmingDecision,
    "warmCost" | "missCost" | "continuationProbability" | "action"
  > {
    type: "cache_warming_decision";
  }

  interface CacheWarmingDecisionEventResult {
    action?: CacheWarmingAction;
  }

  interface CacheWarmingStatus {
    state: "inactive" | "scheduled" | "refreshing";
    reason?: string;
    nextWarmAt?: number;
    decision?: CacheWarmingDecision;
    extensionOverride?: boolean;
  }

  interface CacheWarmRequest {
    model: aiTypes.Model<aiTypes.Api>;
    context: aiTypes.Context;
    options: aiTypes.ModelsSimpleStreamOptions;
  }

  type CacheWarmer = (typeof CacheWarmerClass)["prototype"];

  type CacheWarmingMode = settingsManagerTypes.CacheWarmingMode;

  type BranchEntry = sessionManagerTypes.SessionEntry;

  type WarmedEntry = sessionManagerTypes.UsageEntry;
}

export type { cacheWarmerTypes as default };
