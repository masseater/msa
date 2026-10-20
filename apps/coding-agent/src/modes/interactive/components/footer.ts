import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ContextUsage } from "../../../core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { describeGoalIndicator } from "../../../core/goal.ts";
import { nowMs } from "../../../core/platform.ts";
import { describePrWatchIndicator } from "../../../core/pr-watch/summary.ts";
import { readEnv } from "../../../core/process-env.ts";
import type { SessionManager } from "../../../core/session-manager.ts";
import {
  type UsageTotals,
  addUsageToTotals,
  createUsageTotals,
} from "../../../core/usage-totals.ts";
import { isAbsolute, relative, resolve, sep } from "../../path.ts";
import { theme } from "../theme/theme.ts";
import { viewHelpers } from "./tasks-view-helpers.ts";

const { truncateToWidth, visibleWidth } = tui;

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/gu, " ")
    .replace(/ +/gu, " ")
    .trim();
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export const formatCwdForFooter: {
  (home: string | undefined): (cwd: string) => string;
  (cwd: string, home: string | undefined): string;
} = dual(2, (cwd: string, home: string | undefined): string => {
  if (home === undefined || home === "") return cwd;

  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
});

interface SessionStats {
  session: AgentSession;
  sessionId: string;
  leafId: string | null;
  entryCount: number;
  limitsModel: unknown;
  usageTotals: UsageTotals;
  latestCacheHitRate: number | undefined;
  contextUsage: ContextUsage | undefined;
}

export class FooterComponent implements tuiTypes.Component {
  private autoCompactEnabled = true;
  private session: AgentSession;
  private footerData: ReadonlyFooterDataProvider;
  private sessionStats?: SessionStats;

  constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
    this.session = session;
    this.footerData = footerData;
  }

  setSession(session: AgentSession): void {
    this.session = session;
  }

  setAutoCompactEnabled(enabled: boolean): void {
    this.autoCompactEnabled = enabled;
  }

  invalidate(): void {}

  dispose(): void {}

  private getSessionStats(): SessionStats {
    const getSessionStatsSessionManagerResult = FooterComponent.getSessionStatsSessionManager(this);
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

  private static getSessionStatsSessionManager(self: FooterComponent):
    | { done: true; value: SessionStats }
    | {
        done: false;
        value: {
          sessionManager: SessionManager;
          usageTotals: UsageTotals;
          sessionId: string;
          leafId: string | null;
          entryCount: number;
          limitsModel: aiTypes.Model<any> | undefined;
        };
      } {
    const sessionManager = self.session.sessionManager;
    const entryCount = sessionManager.getEntryCount();
    const sessionId = sessionManager.getSessionId();
    const leafId = sessionManager.getLeafId();
    const limitsModel = self.session.routedModel?.model ?? self.session.model;
    const cached = self.sessionStats;
    if (
      cached !== undefined &&
      cached.session === self.session &&
      cached.sessionId === sessionId &&
      cached.leafId === leafId &&
      cached.entryCount === entryCount &&
      cached.limitsModel === limitsModel
    ) {
      return { done: true, value: cached };
    }

    const usageTotals = createUsageTotals();
    return {
      done: false,
      value: {
        entryCount,
        leafId,
        limitsModel,
        sessionId,
        sessionManager,
        usageTotals,
      },
    };
  }

  render(width: number): string[] {
    const state = this.session.state;
    const { usageTotals, latestCacheHitRate, contextUsage } = this.getSessionStats();
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
      this,
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

  private static renderStatusLines(
    self: FooterComponent,
    statsParts: string[],
    contextPercentStr: string,
    state: agentTypes.AgentState,
    width: number,
    pwd: string,
  ): { tasks: string | undefined; lines: string[] } {
    const { remainder, dimStatsLeft } = FooterComponent.renderRemainder(
      self,
      statsParts,
      contextPercentStr,
      state,
      width,
    );
    const dimRemainder = theme.fg("dim", remainder);

    const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
    const lines = [pwdLine, dimStatsLeft + dimRemainder];

    const goal = self.session.goal;
    if (goal !== undefined) {
      lines.push(
        truncateToWidth(
          theme.fg("accent", describeGoalIndicator(goal, nowMs())),
          width,
          theme.fg("dim", "..."),
        ),
      );
    }

    const prWatch = describePrWatchIndicator(self.session.prWatch);
    if (prWatch !== undefined && prWatch !== "") {
      lines.push(truncateToWidth(theme.fg("dim", prWatch), width, theme.fg("dim", "...")));
    }

    const tasks = viewHelpers.describeTaskCounts(self.session.orchestrator?.snapshot.tasks ?? []);
    return { lines, tasks };
  }

  private static renderRemainder(
    self: FooterComponent,
    statsParts: string[],
    contextPercentStr: string,
    state: agentTypes.AgentState,
    width: number,
  ): { remainder: string; dimStatsLeft: string } {
    let { rightSide, rightSideWithoutProvider, statsLeftWidth, minPadding, statsLeft } =
      FooterComponent.renderRightSide(self, statsParts, contextPercentStr, state, width);
    if (self.footerData.getAvailableProviderCount() > 1 && state.model !== undefined) {
      rightSide = `(${state.model!.provider}) ${rightSideWithoutProvider}`;
      if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
        rightSide = rightSideWithoutProvider;
      }
    }

    const rightSideWidth = visibleWidth(rightSide);
    const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

    let statsLine: string;
    if (totalNeeded <= width) {
      const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
      statsLine = statsLeft + padding + rightSide;
    } else {
      const availableForRight = width - statsLeftWidth - minPadding;
      if (availableForRight > 0) {
        const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
        const truncatedRightWidth = visibleWidth(truncatedRight);
        const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
        statsLine = statsLeft + padding + truncatedRight;
      } else {
        statsLine = statsLeft;
      }
    }

    const dimStatsLeft = theme.fg("dim", statsLeft);
    const remainder = statsLine.slice(statsLeft.length);
    return { dimStatsLeft, remainder };
  }

  private static renderRightSide(
    self: FooterComponent,
    statsParts: any[],
    contextPercentStr: string,
    state: agentTypes.AgentState,
    width: number,
  ): {
    rightSide: string;
    rightSideWithoutProvider: string;
    statsLeftWidth: number;
    minPadding: 2;
    statsLeft: string;
  } {
    statsParts.push(contextPercentStr);
    if (areExperimentalFeaturesEnabled()) {
      statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
    }

    let statsLeft = statsParts.join(" ");

    const modelName = state.model?.id || "no-model";

    let statsLeftWidth = visibleWidth(statsLeft);

    if (statsLeftWidth > width) {
      statsLeft = truncateToWidth(statsLeft, width, "...");
      statsLeftWidth = visibleWidth(statsLeft);
    }

    const minPadding = 2;

    let rightSideWithoutProvider = modelName;
    if (state.model?.reasoning) {
      const thinkingLevel = state.thinkingLevel || "off";
      rightSideWithoutProvider =
        thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
    }
    const routed = self.session.routedModel;
    if (routed !== undefined) {
      const level = routed.thinkingLevel === undefined ? "" : ` • ${routed.thinkingLevel}`;
      rightSideWithoutProvider += ` → ${routed.model.id}${level}`;
    }

    let rightSide = rightSideWithoutProvider;
    return { minPadding, rightSide, rightSideWithoutProvider, statsLeft, statsLeftWidth };
  }
}
