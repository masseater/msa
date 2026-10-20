import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import config from "../../config.ts";
import changelog from "../../utils/changelog.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer10 from "./interactive-mode-layer-10.ts";
import type interactiveModeTypes from "./interactive-mode.types.ts";
import InteractiveThemeController from "./theme/interactive-theme-controller.ts";
import themeModule from "./theme/theme.ts";
import tuiRenderer from "./tui-renderer.ts";

const { createInteractiveTui } = tuiRenderer;
const { APP_NAME, VERSION, getAgentDir } = config;
const { getChangelogPath, getNewEntries, normalizeChangelogLinks, parseChangelog } = changelog;
const { theme } = themeModule;
const { isRetryableAssistantError } = compat;

export default abstract class InteractiveModeLayer11 extends InteractiveModeLayer10 {
  protected createRenderer(
    terminal: interactiveModeTypes.InteractiveModeOptions["terminal"],
    tuiMode: NonNullable<interactiveModeTypes.InteractiveModeOptions["tuiMode"]>,
  ) {
    return createInteractiveTui({
      fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
      logDirectory: getAgentDir(),
      onRightClickPaste: this.onRightClickPaste,
      showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
      terminal,
      tuiMode,
    });
  }

  protected createThemeController(
    initialThemeSetting: interactiveModeTypes.InteractiveModeOptions["initialThemeSetting"],
  ) {
    return new InteractiveThemeController(this.ui, {
      getSettingsManager: () => this.settingsManager,
      initialThemeSetting,
      onChanged: () => this.updateEditorBorderColor(),
      showError: (message) => this.showError(message),
    });
  }

  protected getChangelogForDisplay(): string | undefined {
    if (this.session.state.messages.length > 0) {
      return undefined;
    }

    const lastVersion = this.settingsManager.getLastChangelogVersion();
    const changelogPath = getChangelogPath();
    const entries = parseChangelog(changelogPath);

    if (lastVersion === undefined || lastVersion === "") {
      this.settingsManager.setLastChangelogVersion(VERSION);
      return undefined;
    }

    const newEntries = getNewEntries(entries, lastVersion);
    if (newEntries.length > 0) {
      this.settingsManager.setLastChangelogVersion(VERSION);
      return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
    }

    return undefined;
  }

  protected suggestBugReport(): void {
    if (this.bugReportHintShown) return;
    this.bugReportHintShown = true;
    this.chatContainer.addChild(
      new ThemedText(
        () =>
          theme.fg(
            "muted",
            `If this looks like a ${APP_NAME} bug, /bug sends a report to the developers.`,
          ),
        this.outputPad,
        0,
      ),
    );
    this.ui.requestRender();
  }

  protected maybeSuggestBugReport(message: compatTypes.AssistantMessage): void {
    if (message.stopReason !== "error" || isRetryableAssistantError(message)) return;
    if (/\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b/iu.test(message.errorMessage ?? "")) return;
    if (this.maybeShowInstallChangeWarning()) return;
    this.suggestBugReport();
  }
}
