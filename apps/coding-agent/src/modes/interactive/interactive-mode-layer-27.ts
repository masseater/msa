import type compatTypes from "@msa/ai/compat.types";
import tuiModule from "@msa/tui";

import cacheStats from "../../core/cache-stats.ts";
import type cacheStatsTypes from "../../core/cache-stats.types.ts";
import footerSupport from "./components/footer-support.ts";
import ThemedText from "./components/themed-text.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer26 from "./interactive-mode-layer-26.ts";
import themeModule from "./theme/theme.ts";

const { Spacer } = tuiModule;
const { theme } = themeModule;
const { formatTokens } = footerSupport;
const { CACHE_TTL_MS, detectCacheMiss } = cacheStats;
const { countDroppedThinkingBlocks } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer27 extends InteractiveModeLayer26 {
  protected finishStreamingMessage(message: compatTypes.AssistantMessage): void {
    this.streamingMessage = message;
    let errorMessage: string | undefined;
    if (message.stopReason === "aborted") {
      const retryAttempt = this.session.run.retry.retryAttempt;
      errorMessage =
        retryAttempt > 0
          ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
          : "Operation aborted";
      message.errorMessage = errorMessage;
    }
    this.streamingComponent?.updateContent(message, false);
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      const text =
        errorMessage === undefined || errorMessage === ""
          ? (message.errorMessage ?? "") === ""
            ? "Error"
            : message.errorMessage!
          : errorMessage;
      for (const [, component] of this.pendingTools.entries())
        component.updateResult({ content: [{ text, type: "text" }], isError: true });
      this.pendingTools.clear();
      this.maybeSuggestBugReport(message);
    } else {
      for (const [, component] of this.pendingTools.entries()) component.setArgsComplete();
      this.maybeShowThinkingDropNotice(message);
      this.maybeShowCacheMissNotice(message);
    }
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.footer.invalidate();
  }

  protected addCompactionCostNotice(
    notice: interactiveModeInternalTypes.CompactionCostNotice,
  ): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;

    const { usage } = notice;
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const cost = usage.cost.total >= 0.01 ? ` (~$${usage.cost.total.toFixed(2)})` : "";
    const label = notice.kind === "compaction" ? "Compaction" : "Branch summary";
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("warning", `${label}: ${formatTokens(tokens)} tokens billed${cost}`),
        1,
        0,
      ),
    );
  }

  protected maybeShowThinkingDropNotice(message: compatTypes.AssistantMessage): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;

    const droppedCount = countDroppedThinkingBlocks(message);
    if (droppedCount === 0) return;

    let previousDroppedCount = 0;
    const branch = this.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type === "message" && entry.message.role === "assistant") {
        previousDroppedCount = countDroppedThinkingBlocks(entry.message);
        break;
      }
    }
    if (droppedCount <= previousDroppedCount) return;

    const noun = droppedCount === 1 ? "thinking block" : "thinking blocks";
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("warning", `Anthropic dropped ${droppedCount} ${noun} (details in session)`),
        1,
        0,
      ),
    );
  }

  protected maybeShowCacheMissNotice(message: compatTypes.AssistantMessage): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;

    const miss = detectCacheMiss(
      this.sessionManager.getEntries(),
      message,
      this.session.models.selection.modelRuntime,
    );
    if (miss !== undefined) this.addCacheMissNotice(miss);
  }

  protected addCacheMissNotice(miss: cacheStatsTypes.CacheMiss): void {
    if (miss.missedTokens < 20_000 && miss.missedCost < 0.1) return;

    const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
    const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
    let label = "Cache miss";
    if (miss.modelChanged) {
      label = "Cache miss after model switch";
    } else if (miss.idleMs >= CACHE_TTL_MS) {
      label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
    }
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("warning", `${label}: ${reBilled}`), 1, 0),
    );
  }
}
