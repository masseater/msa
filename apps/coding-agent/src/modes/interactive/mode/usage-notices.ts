import type compatTypes from "@msa/ai/compat.types";
import tuiModule from "@msa/tui";

import footerSupport from "../components/footer-support.ts";
import ThemedText from "../components/themed-text.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Spacer } = tuiModule;
const { countDroppedThinkingBlocks } = interactiveModeHelpers;
const { formatTokens } = footerSupport;

export default class UsageNotices {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  addCompactionCostNotice(notice: interactiveModeInternalTypes.CompactionCostNotice): void {
    if (!this.mode.settingsManager.display.getShowCacheMissNotices()) return;

    const { usage } = notice;
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const cost = usage.cost.total >= 0.01 ? ` (~$${usage.cost.total.toFixed(2)})` : "";
    const label = notice.kind === "compaction" ? "Compaction" : "Branch summary";
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("warning", `${label}: ${formatTokens(tokens)} tokens billed${cost}`),
        1,
        0,
      ),
    );
  }

  maybeShowThinkingDropNotice(message: compatTypes.AssistantMessage): void {
    if (!this.mode.settingsManager.display.getShowCacheMissNotices()) return;

    const droppedCount = countDroppedThinkingBlocks(message);
    if (droppedCount === 0) return;

    let previousDroppedCount = 0;
    const branch = this.mode.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type === "message" && entry.message.role === "assistant") {
        previousDroppedCount = countDroppedThinkingBlocks(entry.message);
        break;
      }
    }
    if (droppedCount <= previousDroppedCount) return;

    const noun = droppedCount === 1 ? "thinking block" : "thinking blocks";
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("warning", `Anthropic dropped ${droppedCount} ${noun} (details in session)`),
        1,
        0,
      ),
    );
  }
}
