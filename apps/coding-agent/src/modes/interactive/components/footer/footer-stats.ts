import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import usageTotalsModule from "../../../../core/usage-totals.ts";
import type usageTotalsTypes from "../../../../core/usage-totals.types.ts";
import type footerInternalTypes from "../footer-internal.types.ts";
import type FooterComponent from "../footer.ts";

const { addUsageToTotals, createUsageTotals } = usageTotalsModule;

const sumUsage = (
  entries: readonly sessionManagerTypes.SessionEntry[],
): { usageTotals: usageTotalsTypes.UsageTotals; latestCacheHitRate: number | undefined } => {
  const usageTotals = createUsageTotals();
  let latestCacheHitRate: number | undefined;
  for (const entry of entries) {
    if (entry.type === "usage") {
      addUsageToTotals(usageTotals, entry.usage);
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      const { usage } = entry.message;
      addUsageToTotals(usageTotals, usage);
      const latestPromptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
      latestCacheHitRate =
        latestPromptTokens > 0 ? (usage.cacheRead / latestPromptTokens) * 100 : undefined;
    } else if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.usage !== undefined
    ) {
      addUsageToTotals(usageTotals, entry.message.usage);
    } else if (
      (entry.type === "branch_summary" || entry.type === "compaction") &&
      entry.usage !== undefined
    ) {
      addUsageToTotals(usageTotals, entry.usage);
    }
  }
  return { latestCacheHitRate, usageTotals };
};

export default class FooterStats {
  private readonly footer: FooterComponent;

  constructor(footer: FooterComponent) {
    this.footer = footer;
  }

  getSessionStats(): footerInternalTypes.SessionStats {
    const { session } = this.footer;
    const { sessionManager } = session;
    const entryCount = sessionManager.getEntryCount();
    const sessionId = sessionManager.getSessionId();
    const leafId = sessionManager.getLeafId();
    const limitsModel = session.models.selection.routedModel?.model ?? session.model;
    const cached = this.footer.sessionStats;
    if (
      cached !== undefined &&
      cached.session === session &&
      cached.sessionId === sessionId &&
      cached.leafId === leafId &&
      cached.entryCount === entryCount &&
      cached.limitsModel === limitsModel
    ) {
      return cached;
    }

    const { usageTotals, latestCacheHitRate } = sumUsage(sessionManager.getEntries());
    this.footer.sessionStats = {
      contextUsage: session.context.stats.getContextUsage(),
      entryCount,
      latestCacheHitRate,
      leafId,
      limitsModel,
      session,
      sessionId,
      usageTotals,
    };
    return this.footer.sessionStats;
  }
}
