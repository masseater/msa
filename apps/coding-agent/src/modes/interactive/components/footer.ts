import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import experimental from "../../../core/experimental.ts";
import goalModule from "../../../core/goal.ts";
import platform from "../../../core/platform.ts";
import summary from "../../../core/pr-watch/summary.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import usageTotalsModule from "../../../core/usage-totals.ts";
import type usageTotalsTypes from "../../../core/usage-totals.types.ts";
import themeModule from "../theme/theme.ts";
import type footerInternalTypes from "./footer-internal.types.ts";
import FooterComponentLayer2 from "./footer-layer-2.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";

const { createUsageTotals } = usageTotalsModule;
const { theme } = themeModule;
const { truncateToWidth, visibleWidth } = tui;
const { describeGoalIndicator } = goalModule;
const { nowMs } = platform;
const { describePrWatchIndicator } = summary;
const { viewHelpers } = tasksViewHelpers;
const { areExperimentalFeaturesEnabled } = experimental;

export default class FooterComponent extends FooterComponentLayer2 implements tuiTypes.Component {
  static getSessionStatsSessionManager(self: FooterComponent):
    | { done: true; value: footerInternalTypes.SessionStats }
    | {
        done: false;
        value: {
          sessionManager: sessionManagerTypes.SessionManager;
          usageTotals: usageTotalsTypes.UsageTotals;
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
    const limitsModel = self.session.models.selection.routedModel?.model ?? self.session.model;
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

  static renderStatusLines(
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

    const goal = self.session.integrations.goal.goal;
    if (goal !== undefined) {
      lines.push(
        truncateToWidth(
          theme.fg("accent", describeGoalIndicator(goal, nowMs())),
          width,
          theme.fg("dim", "..."),
        ),
      );
    }

    const prWatch = describePrWatchIndicator(self.session.integrations.prWatch.prWatch);
    if (prWatch !== undefined && prWatch !== "") {
      lines.push(truncateToWidth(theme.fg("dim", prWatch), width, theme.fg("dim", "...")));
    }

    const tasks = viewHelpers.describeTaskCounts(
      self.session.integrations.orchestration.orchestrator?.snapshot.tasks ?? [],
    );
    return { lines, tasks };
  }

  static renderRemainder(
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

  static renderRightSide(
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
    const routed = self.session.models.selection.routedModel;
    if (routed !== undefined) {
      const level = routed.thinkingLevel === undefined ? "" : ` • ${routed.thinkingLevel}`;
      rightSideWithoutProvider += ` → ${routed.model.id}${level}`;
    }

    let rightSide = rightSideWithoutProvider;
    return { minPadding, rightSide, rightSideWithoutProvider, statsLeft, statsLeftWidth };
  }
}
