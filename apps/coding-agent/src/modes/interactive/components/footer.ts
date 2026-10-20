import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../../core/agent-session.types.ts";
import type footerDataProviderTypes from "../../../core/footer-data-provider.types.ts";
import themeModule from "../theme/theme.ts";
import footerHelpers from "./footer-helpers.ts";
import type footerInternalTypes from "./footer-internal.types.ts";
import FooterLines from "./footer/footer-lines.ts";
import FooterStats from "./footer/footer-stats.ts";
import FooterSummary from "./footer/footer-summary.ts";
const { theme } = themeModule;
const { truncateToWidth } = tui;
const { sanitizeStatusText } = footerHelpers;

export default class FooterComponent implements tuiTypes.Component {
  readonly stats: FooterStats;
  readonly lines: FooterLines;
  readonly summary: FooterSummary;

  autoCompactEnabled = true;

  session!: agentSessionTypes.AgentSession;

  footerData!: footerDataProviderTypes.ReadonlyFooterDataProvider;

  sessionStats?: footerInternalTypes.SessionStats;

  setSession(session: agentSessionTypes.AgentSession): void {
    this.session = session;
  }

  setAutoCompactEnabled(enabled: boolean): void {
    this.autoCompactEnabled = enabled;
  }

  invalidate(): void {}

  dispose(): void {}

  render(width: number): string[] {
    const state = this.session.state;
    const { usageTotals, latestCacheHitRate, contextUsage } = this.stats.getSessionStats();
    const { statsParts, contextPercentStr, pwd } = this.summary.statsParts(
      contextUsage,
      state,
      usageTotals,
      latestCacheHitRate,
    );
    const { tasks, lines } = this.lines.renderStatusLines(
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

  constructor(
    session: agentSessionTypes.AgentSession,
    footerData: footerDataProviderTypes.ReadonlyFooterDataProvider,
  ) {
    this.stats = new FooterStats(this);
    this.lines = new FooterLines(this);
    this.summary = new FooterSummary(this);
    this.session = session;
    this.footerData = footerData;
  }
}
