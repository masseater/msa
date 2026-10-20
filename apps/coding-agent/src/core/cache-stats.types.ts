declare namespace cacheStatsTypes {
  interface CacheMiss {
    missedTokens: number;
    missedCost: number;
    idleMs: number;
    modelChanged: boolean;
  }

  interface CacheWasteTotals {
    missedTokens: number;
    missedCost: number;
    missCount: number;
  }

  interface ModelPriceSource {
    getModel(provider: string, modelId: string): { cost: { cacheRead: number } } | undefined;
  }
}

export type { cacheStatsTypes as default };
