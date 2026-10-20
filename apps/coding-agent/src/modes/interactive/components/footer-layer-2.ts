import tui from "@msa/tui";

import themeModule from "../theme/theme.ts";
import footerHelpers from "./footer-helpers.ts";
import FooterComponentLayer1 from "./footer-layer-1.ts";
import footerSupport from "./footer-support.ts";
import FooterComponent from "./footer.ts";

const { formatTokens } = footerSupport;
const { theme } = themeModule;
const { truncateToWidth } = tui;
const { sanitizeStatusText } = footerHelpers;

export default abstract class FooterComponentLayer2 extends FooterComponentLayer1 {
  render(width: number): string[] {
    const state = this.session.state;
    const { usageTotals, latestCacheHitRate, contextUsage } = this.getSessionStats();
    let { usingSubscription, statsParts, contextPercent, contextWindow, contextPercentValue, pwd } =
      this.renderPart1(contextUsage, state, usageTotals, latestCacheHitRate);
    if (usageTotals.cost !== 0 || usingSubscription) {
      const costStr = `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
      statsParts.push(costStr);
    }

    let contextPercentStr: string;
    const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
    const contextPercentDisplay =
      contextPercent === "?"
        ? `?/${formatTokens(contextWindow)}${autoIndicator}`
        : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
    if (contextPercentValue > 90) {
      contextPercentStr = theme.fg("error", contextPercentDisplay);
    } else if (contextPercentValue > 70) {
      contextPercentStr = theme.fg("warning", contextPercentDisplay);
    } else {
      contextPercentStr = contextPercentDisplay;
    }
    const { tasks, lines } = FooterComponent.renderStatusLines(
      this as unknown as FooterComponent,
      statsParts,
      contextPercentStr,
      state,
      width,
      pwd,
    );
    if (tasks !== undefined && tasks !== "") {
      lines.push(
        truncateToWidth(`${tasks}  ${theme.fg("dim", "/tasks")}`, width, theme.fg("dim", "...")),
      );
    }

    const extensionStatuses = this.footerData.getExtensionStatuses();
    if (extensionStatuses.size > 0) {
      const sortedStatuses = Array.from(extensionStatuses.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, text]) => sanitizeStatusText(text));
      const statusLine = sortedStatuses.join(" ");
      lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
    }

    return lines;
  }
}
