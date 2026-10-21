import type agentTypes from "@msa/agent-core/index.types";

import type typesUiTypes from "../../../../core/extensions/types-ui.ts";
import platform from "../../../../core/platform/index.ts";
import type usageTotalsTypes from "../../../../core/usage-totals.types.ts";
import themeModule from "../../theme/theme.ts";
import footerSupport from "../footer-support.ts";
import type FooterComponent from "../footer.ts";

const { formatCwdForFooter, formatTokens } = footerSupport;
const { readEnv } = platform;

const { theme } = themeModule;

export default class FooterSummary {
  private readonly footer: FooterComponent;

  constructor(footer: FooterComponent) {
    this.footer = footer;
  }

  statsParts(
    contextUsage: typesUiTypes.ContextUsage | undefined,
    state: agentTypes.AgentState,
    usageTotals: usageTotalsTypes.UsageTotals,
    latestCacheHitRate: number | undefined,
  ) {
    const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
    const contextPercentValue = contextUsage?.percent ?? 0;
    const contextPercent = contextUsage?.percent === null ? "?" : contextPercentValue.toFixed(1);

    const pwd = this.locationText();

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
        : this.footer.session.models.selection.modelRuntime.isUsingSubscription(
            state.model.provider,
          );
    if (usageTotals.cost !== 0 || usingSubscription) {
      statsParts.push(`$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
    }
    return {
      contextPercentStr: this.contextIndicator(contextPercent, contextWindow, contextPercentValue),
      pwd,
      statsParts,
    };
  }

  private locationText(): string {
    let pwd = formatCwdForFooter(
      this.footer.session.sessionManager.getCwd(),
      readEnv("HOME") || readEnv("USERPROFILE"),
    );

    const branch = this.footer.footerData.getGitBranch();
    if (branch !== null && branch !== "") {
      pwd = `${pwd} (${branch})`;
    }

    const sessionName = this.footer.session.sessionManager.getSessionName();
    if (sessionName !== undefined && sessionName !== "") {
      pwd = `${pwd} • ${sessionName}`;
    }
    return pwd;
  }

  private contextIndicator(
    contextPercent: string,
    contextWindow: number,
    contextPercentValue: number,
  ): string {
    const autoIndicator = this.footer.autoCompactEnabled ? " (auto)" : "";
    const display =
      contextPercent === "?"
        ? `?/${formatTokens(contextWindow)}${autoIndicator}`
        : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
    if (contextPercentValue > 90) return theme.fg("error", display);
    if (contextPercentValue > 70) return theme.fg("warning", display);
    return display;
  }
}
