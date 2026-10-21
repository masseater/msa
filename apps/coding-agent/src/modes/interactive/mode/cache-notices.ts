import type compatTypes from "@msa/ai/compat.types";
import tuiModule from "@msa/tui";

import cacheStats from "../../../core/cache-stats.ts";
import type cacheStatsTypes from "../../../core/cache-stats.types.ts";
import cacheWarmerSupport from "../../../core/cache-warmer-support.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import footerSupport from "../components/footer-support.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer } = tuiModule;
const { CACHE_TTL_MS, detectCacheMiss } = cacheStats;
const { formatCacheWarmingUsage } = cacheWarmerSupport;
const { formatTokens } = footerSupport;

export default class CacheNotices {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  addCacheWarmingUsage(entry: sessionManagerTypes.UsageEntry): void {
    if (!this.mode.settingsManager.display.getShowCacheMissNotices()) return;
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    const usage = formatCacheWarmingUsage(entry);
    this.mode.layout.chatContainer.addChild(new ThemedText(() => theme.fg("dim", usage), 1, 0));
  }

  maybeShowCacheMissNotice(message: compatTypes.AssistantMessage): void {
    if (!this.mode.settingsManager.display.getShowCacheMissNotices()) return;

    const miss = detectCacheMiss(
      this.mode.sessionManager.getEntries(),
      message,
      this.mode.session.models.selection.modelRuntime,
    );
    if (miss !== undefined) this.addCacheMissNotice(miss);
  }

  addCacheMissNotice(miss: cacheStatsTypes.CacheMiss): void {
    if (miss.missedTokens < 20_000 && miss.missedCost < 0.1) return;

    const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
    const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
    let label = "Cache miss";
    if (miss.modelChanged) {
      label = "Cache miss after model switch";
    } else if (miss.idleMs >= CACHE_TTL_MS) {
      label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
    }
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(() => theme.fg("warning", `${label}: ${reBilled}`), 1, 0),
    );
  }
}
