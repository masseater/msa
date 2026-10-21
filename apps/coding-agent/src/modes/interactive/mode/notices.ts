import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import tuiModule from "@msa/tui";

import config from "../../../config.ts";
import trustManager from "../../../core/trust-manager.ts";
import ThemedText from "../components/themed-text.ts";
import interactiveModeSupport from "../interactive-mode-support.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { APP_NAME, VERSION, detectInstallChange, CONFIG_DIR_NAME } = config;
const { Spacer } = tuiModule;
const { formatResumeCommand } = interactiveModeSupport;
const { isRetryableAssistantError } = compat;
const { hasTrustRequiringProjectResources } = trustManager;

export default class ChatNotices {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private bugReportHintShown = false;

  private installChangeWarningShown = false;

  maybeShowInstallChangeWarning(): Promise<boolean> {
    if (this.installChangeWarningShown) return Promise.resolve(true);
    return Promise.all([detectInstallChange(), formatResumeCommand(this.mode.sessionManager)]).then(
      ([change, resumeCommand]) => this.showInstallChangeWarning(change, resumeCommand),
    );
  }

  private showInstallChangeWarning(
    change: Awaited<ReturnType<typeof detectInstallChange>>,
    resumeCommand: string | undefined,
  ): boolean {
    if (change === undefined || this.installChangeWarningShown)
      return this.installChangeWarningShown;
    this.installChangeWarningShown = true;
    const cause =
      change.kind === "updated"
        ? `${APP_NAME} was updated to ${change.version} while this session was running (${VERSION})`
        : `The ${APP_NAME} installation this session runs from was removed or replaced`;
    const restart =
      resumeCommand !== undefined && resumeCommand !== ""
        ? `Restart with \`${resumeCommand}\` to continue this session.`
        : `Restart ${APP_NAME}.`;
    this.mode.display.status.showWarning(
      `${cause}. Features that load code on demand can fail until restart. ${restart}`,
    );
    return true;
  }

  private suggestBugReport(): void {
    if (this.bugReportHintShown) return;
    this.bugReportHintShown = true;
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () =>
          theme.fg(
            "muted",
            `If this looks like a ${APP_NAME} bug, /bug sends a report to the developers.`,
          ),
        this.mode.display.thinking.outputPad,
        0,
      ),
    );
    this.mode.ui.requestRender();
  }

  maybeSuggestBugReport(message: compatTypes.AssistantMessage): Promise<void> {
    if (message.stopReason !== "error" || isRetryableAssistantError(message))
      return Promise.resolve();
    if (/\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b/iu.test(message.errorMessage ?? ""))
      return Promise.resolve();
    return Promise.resolve(this.maybeShowInstallChangeWarning()).then((shown) =>
      shown ? undefined : this.suggestBugReport(),
    );
  }

  renderProjectTrustWarningIfNeeded(): void {
    if (
      this.mode.settingsManager.isProjectTrusted() ||
      !hasTrustRequiringProjectResources(this.mode.sessionManager.getCwd())
    ) {
      return;
    }

    if (this.mode.layout.chatContainer.children.length > 0) {
      this.mode.layout.chatContainer.addChild(new Spacer(1));
    }
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () =>
          theme.fg(
            "warning",
            `This project is not trusted. Project ${CONFIG_DIR_NAME} resources and packages are ignored. Use /trust to save a trust decision, then restart msa.`,
          ),
        1,
        0,
      ),
    );
  }
}
