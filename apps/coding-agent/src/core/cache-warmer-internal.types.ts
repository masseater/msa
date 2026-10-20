import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type platformTypes from "./platform.types.ts";

declare namespace cacheWarmerInternalTypes {
  interface ActiveRun extends cacheWarmerTypes.CacheWarmRequest {
    isCurrent: () => boolean;
    ttlMs: number;
    delayMs: number;
    refreshDeadlineAt: number;
    startedAt: number;
    controller: AbortController;
    phase: "streaming" | "idle";
    nextWarmAt: number;
    extensionOverride: boolean;
    timer?: platformTypes.Scheduled | undefined;
  }
}

export type { cacheWarmerInternalTypes as default };
