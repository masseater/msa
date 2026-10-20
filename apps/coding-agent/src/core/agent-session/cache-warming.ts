import type AgentSession from "../agent-session.ts";
import type cacheWarmerTypes from "../cache-warmer.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";

export default class SessionCacheWarming {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  cacheWarmer?:
    | Pick<
        cacheWarmerTypes.CacheWarmer,
        "cancel" | "status" | "onAgentSettled" | "onModeChanged" | "onWarmed"
      >
    | undefined;

  get cacheWarmingStatus(): cacheWarmerTypes.CacheWarmingStatus | undefined {
    return this.cacheWarmer?.status;
  }

  setCacheWarmingMode(mode: settingsManagerTypes.CacheWarmingMode): void {
    this.session.settingsManager.setCacheWarmingMode(mode);
    this.cacheWarmer?.onModeChanged();
  }

  configure(cacheWarmer: SessionCacheWarming["cacheWarmer"]): void {
    this.cacheWarmer = cacheWarmer;
    if (cacheWarmer !== undefined) {
      cacheWarmer.onWarmed = (entry) => this.session.emit({ entry, type: "entry_appended" });
    }
  }

  dispose(): void {
    if (this.cacheWarmer !== undefined) {
      this.cacheWarmer.onWarmed = undefined;
      this.cacheWarmer.cancel();
    }
  }
}
