import tuiModule from "@msa/tui";

import cacheWarmerSupport from "../../core/cache-warmer-support.ts";
import type keybindingsTypes from "../../core/keybindings.types.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import ExpandableText from "./components/expandable-text.ts";
import keybindingHints from "./components/keybinding-hints.ts";
import logo from "./components/logo.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer22 from "./interactive-mode-layer-22.ts";
import themeModule from "./theme/theme.ts";

const { wordmark } = logo;
const { theme } = themeModule;
const { keyHint, keyText, rawKeyHint } = keybindingHints;
const { Spacer } = tuiModule;
const { formatCacheWarmingUsage } = cacheWarmerSupport;

export default abstract class InteractiveModeLayer23 extends InteractiveModeLayer22 {
  protected initShowDetails(startupVisibility: { header: boolean; details: boolean }): {
    showDetails: boolean;
    withWordmark: (hints: string) => string;
    compactInstructions: () => string;
    expandedInstructions: () => string;
  } {
    const showDetails = startupVisibility.details;
    const withWordmark = (hints: string) =>
      `${wordmark()} ${theme.fg("dim", `v${this.version}`)}\n${hints}`;

    const hint = (keybinding: keybindingsTypes.AppKeybinding, description: string) =>
      keyHint(keybinding, description);

    const expandedInstructions = () =>
      [
        hint("app.interrupt", "to interrupt"),
        hint("app.clear", "to clear"),
        rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
        hint("app.exit", "to exit (empty)"),
        hint("app.suspend", "to suspend"),
        keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
        hint("app.thinking.cycle", "to cycle thinking level"),
        rawKeyHint(
          `${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`,
          "to cycle models",
        ),
        hint("app.model.select", "to select model"),
        hint("app.tools.expand", "to expand tools"),
        hint("app.thinking.toggle", "to expand thinking"),
        hint("app.editor.external", "for external editor"),
        rawKeyHint("/", "for commands"),
        rawKeyHint("!", "to run bash"),
        rawKeyHint("!!", "to run bash (no context)"),
        hint("app.message.followUp", "to queue follow-up"),
        hint("app.message.dequeue", "to edit all queued messages"),
        hint("app.clipboard.pasteImage", "to paste files on macOS, images, or text"),
        rawKeyHint("drop files", "to attach"),
      ].join("\n");
    const compactInstructions = () =>
      [
        hint("app.interrupt", "interrupt"),
        rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
        rawKeyHint("/", "commands"),
        rawKeyHint("!", "bash"),
        hint("app.tools.expand", "more"),
      ].join(theme.fg("muted", " · "));
    return { compactInstructions, expandedInstructions, showDetails, withWordmark };
  }

  protected initPart4(
    showDetails: boolean,
    withWordmark: (hints: string) => string,
    compactInstructions: () => string,
    expandedInstructions: () => string,
  ): void {
    const compactOnboarding = () =>
      theme.fg(
        "dim",
        `Press ${keyText("app.tools.expand")} to show full startup help${showDetails ? " and loaded resources" : ""}.`,
      );
    const onboarding = () =>
      theme.fg(
        "dim",
        `msa can explain its own features and look up its docs. Ask it how to use or extend msa.`,
      );
    const header = new ExpandableText(
      () => `${withWordmark(compactInstructions())}\n${compactOnboarding()}\n\n${onboarding()}`,
      () => `${withWordmark(expandedInstructions())}\n\n${onboarding()}`,
      this.isStartupExpanded(),
      1,
      0,
    );
    this.builtInHeader = header;

    this.headerContainer.addChild(new Spacer(1));
    this.headerContainer.addChild(this.builtInHeader);
    this.headerContainer.addChild(new Spacer(1));
  }

  protected addCacheWarmingUsage(entry: sessionManagerTypes.UsageEntry): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;
    this.chatContainer.addChild(new Spacer(1));
    const usage = formatCacheWarmingUsage(entry);
    this.chatContainer.addChild(new ThemedText(() => theme.fg("dim", usage), 1, 0));
  }
}
