import type agentTypes from "@msa/agent-core/index.types";

import type agentSessionTypes from "../../../core/agent-session.types.ts";
import type typesUiTypes from "../../../core/extensions/types-ui.ts";
import processEnv from "../../../core/process-env.ts";
import usageTotalsModule from "../../../core/usage-totals.ts";
import type usageTotalsTypes from "../../../core/usage-totals.types.ts";
import type footerInternalTypes from "./footer-internal.types.ts";
import FooterComponentLayer0 from "./footer-layer-0.ts";
import footerSupport from "./footer-support.ts";
import FooterComponent from "./footer.ts";

const { addUsageToTotals } = usageTotalsModule;
const { formatCwdForFooter, formatTokens } = footerSupport;
const { readEnv } = processEnv;

export default abstract class FooterComponentLayer1 extends FooterComponentLayer0 {
  setSession(session: agentSessionTypes.AgentSession): void {
    this.session = session;
  }

  setAutoCompactEnabled(enabled: boolean): void {
    this.autoCompactEnabled = enabled;
  }

  invalidate(): void {}

  dispose(): void {}

  protected getSessionStats(): footerInternalTypes.SessionStats {
    const getSessionStatsSessionManagerResult = FooterComponent.getSessionStatsSessionManager(
      this as unknown as FooterComponent,
    );
    if (getSessionStatsSessionManagerResult.done) return getSessionStatsSessionManagerResult.value;
    let { sessionManager, usageTotals, sessionId, leafId, entryCount, limitsModel } =
      getSessionStatsSessionManagerResult.value;
    let latestCacheHitRate: number | undefined;

    for (const entry of sessionManager.getEntries()) {
      if (entry.type === "usage") {
        addUsageToTotals(usageTotals, entry.usage);
      } else if (entry.type === "message" && entry.message.role === "assistant") {
        addUsageToTotals(usageTotals, entry.message.usage);

        const latestPromptTokens =
          entry.message.usage.input +
          entry.message.usage.cacheRead +
          entry.message.usage.cacheWrite;
        latestCacheHitRate =
          latestPromptTokens > 0
            ? (entry.message.usage.cacheRead / latestPromptTokens) * 100
            : undefined;
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

    const contextUsage = this.session.getContextUsage();
    this.sessionStats = {
      contextUsage,
      entryCount,
      latestCacheHitRate,
      leafId,
      limitsModel,
      session: this.session,
      sessionId,
      usageTotals,
    };
    return this.sessionStats;
  }

  protected renderPart1(
    contextUsage: typesUiTypes.ContextUsage | undefined,
    state: agentTypes.AgentState,
    usageTotals: usageTotalsTypes.UsageTotals,
    latestCacheHitRate: number | undefined,
  ) {
    const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
    const contextPercentValue = contextUsage?.percent ?? 0;
    const contextPercent = contextUsage?.percent === null ? "?" : contextPercentValue.toFixed(1);

    let pwd = formatCwdForFooter(
      this.session.sessionManager.getCwd(),
      readEnv("HOME") || readEnv("USERPROFILE"),
    );

    const branch = this.footerData.getGitBranch();
    if (branch !== null && branch !== "") {
      pwd = `${pwd} (${branch})`;
    }

    const sessionName = this.session.sessionManager.getSessionName();
    if (sessionName !== undefined && sessionName !== "") {
      pwd = `${pwd} • ${sessionName}`;
    }

    const statsParts = [];
    if (usageTotals.input !== 0) statsParts.push(`↑${formatTokens(usageTotals.input)}`);
    if (usageTotals.output !== 0) statsParts.push(`↓${formatTokens(usageTotals.output)}`);
    if (usageTotals.cacheRead !== 0) statsParts.push(`R${formatTokens(usageTotals.cacheRead)}`);
    if (usageTotals.cacheWrite !== 0) statsParts.push(`W${formatTokens(usageTotals.cacheWrite)}`);
    if (
      (usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) &&
      latestCacheHitRate !== undefined
    ) {
      statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
    }

    const usingSubscription =
      state.model === undefined
        ? false
        : this.session.modelRuntime.isUsingSubscription(state.model.provider);
    return {
      contextPercent,
      contextPercentValue,
      contextWindow,
      pwd,
      statsParts,
      usingSubscription,
    };
  }
}
