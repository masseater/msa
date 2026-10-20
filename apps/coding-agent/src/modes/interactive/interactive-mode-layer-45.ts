import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import cacheStats from "../../core/cache-stats.ts";
import telemetrySupport from "../../core/observability/telemetry-support.ts";
import usageTotals from "../../core/usage-totals.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer44 from "./interactive-mode-layer-44.ts";
import sessionInfo from "./session-info.ts";
import type sessionInfoTypes from "./session-info.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { computeCacheWaste } = cacheStats;
const { describeTelemetry } = telemetrySupport;
const { getUsageCostBreakdown } = usageTotals;
const { Spacer } = tuiModule;
const { formatSessionInfo } = sessionInfo;

export default abstract class InteractiveModeLayer45 extends InteractiveModeLayer44 {
  protected handleSessionCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entries = this.sessionManager.getEntries();
        const model = this.session.model;
        const contextBreakdown = yield* awaited(this.session.getContextBreakdown());
        const telemetry = this.runtimeHost.telemetry;
        const info: sessionInfoTypes.SessionInfo = {
          cacheWarmingMode: this.settingsManager.getCacheWarmingMode(),
          cacheWarmingStatus: this.session.cacheWarmingStatus,
          cacheWaste: computeCacheWaste(entries, this.session.modelRuntime),
          contextBreakdown,
          contextWindow: this.session.getContextUsage()?.contextWindow ?? model?.contextWindow,
          selectedModelKey: `${model?.provider}/${model?.id}`,
          sessionName: this.sessionManager.getSessionName(),
          stats: this.session.getSessionStats(),
          telemetry: telemetry === undefined ? undefined : describeTelemetry(telemetry.status()),
          usageBreakdown: getUsageCostBreakdown(entries),
        };
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new ThemedText(() => formatSessionInfo(info), 1, 0));
        this.ui.requestRender();
      }, this),
    );
  }
}
