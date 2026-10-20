import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import cacheStats from "../../../core/cache-stats.ts";
import telemetrySupport from "../../../core/observability/telemetry-support.ts";
import usageTotals from "../../../core/usage-totals.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import sessionInfo from "../session-info.ts";
import type sessionInfoTypes from "../session-info.types.ts";

const { Spacer } = tuiModule;
const { awaited, awaitingWith } = awaitingModule;
const { computeCacheWaste } = cacheStats;
const { describeTelemetry } = telemetrySupport;
const { getUsageCostBreakdown } = usageTotals;
const { formatSessionInfo } = sessionInfo;

export default class SessionInfoCommand {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  handleSessionCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entries = this.mode.sessionManager.getEntries();
        const model = this.mode.session.model;
        const contextBreakdown = yield* awaited(
          this.mode.session.context.breakdown.getContextBreakdown(),
        );
        const telemetry = this.mode.runtimeHost.telemetry;
        const info: sessionInfoTypes.SessionInfo = {
          cacheWarmingMode: this.mode.settingsManager.getCacheWarmingMode(),
          cacheWarmingStatus: this.mode.session.models.cacheWarming.cacheWarmingStatus,
          cacheWaste: computeCacheWaste(entries, this.mode.session.models.selection.modelRuntime),
          contextBreakdown,
          contextWindow:
            this.mode.session.context.stats.getContextUsage()?.contextWindow ??
            model?.contextWindow,
          selectedModelKey: `${model?.provider}/${model?.id}`,
          sessionName: this.mode.sessionManager.getSessionName(),
          stats: this.mode.session.context.stats.getSessionStats(),
          telemetry: telemetry === undefined ? undefined : describeTelemetry(telemetry.status()),
          usageBreakdown: getUsageCostBreakdown(entries),
        };
        this.mode.layout.chatContainer.addChild(new Spacer(1));
        this.mode.layout.chatContainer.addChild(
          new ThemedText(() => formatSessionInfo(info), 1, 0),
        );
        this.mode.ui.requestRender();
      }, this),
    );
  }
}
