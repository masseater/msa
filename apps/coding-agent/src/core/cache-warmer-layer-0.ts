import * as Effect from "effect/Effect";

import type cacheWarmerInternalTypes from "./cache-warmer-internal.types.ts";
import type cacheWarmerTypes from "./cache-warmer.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

export default abstract class CacheWarmerLayer0 {
  constructor(
    models: Pick<modelRuntimeTypes.ModelRuntime, "streamSimple">,
    sessionManager: Pick<sessionManagerTypes.SessionManager, "appendUsage" | "getBranch">,
    getMode: () => settingsManagerTypes.CacheWarmingMode,
    decide: (
      event: cacheWarmerTypes.CacheWarmingDecisionEvent,
    ) => Promise<cacheWarmerTypes.CacheWarmingAction> = (event) =>
      Effect.runPromise(Effect.sync(() => event.action)),
  ) {
    this.models = models;
    this.sessionManager = sessionManager;
    this.getMode = getMode;
    this.decide = decide;
    this.inactive = { reason: "waiting for first request", state: "inactive" };
  }

  protected run?: cacheWarmerInternalTypes.ActiveRun | undefined;
  protected inactive!: cacheWarmerTypes.CacheWarmingStatus;
  protected models!: Pick<modelRuntimeTypes.ModelRuntime, "streamSimple">;
  protected sessionManager!: Pick<sessionManagerTypes.SessionManager, "appendUsage" | "getBranch">;
  protected getMode!: () => settingsManagerTypes.CacheWarmingMode;
  protected decide!: (
    event: cacheWarmerTypes.CacheWarmingDecisionEvent,
  ) => Promise<cacheWarmerTypes.CacheWarmingAction>;
  onWarmed?: ((entry: sessionManagerTypes.UsageEntry) => void) | undefined;
}
