import tuiModule from "@msa/tui";

import config from "../../config.ts";
import trustManager from "../../core/trust-manager.ts";
import type versionCheckTypes from "../../utils/version-check.types.ts";
import DynamicBorder from "./components/dynamic-border.ts";
import ThemedText from "./components/themed-text.ts";
import InteractiveModeLayer29 from "./interactive-mode-layer-29.ts";
import themeModule from "./theme/theme.ts";

const { hasTrustRequiringProjectResources } = trustManager;
const { Spacer, getCapabilities, hyperlink } = tuiModule;
const { theme } = themeModule;
const { APP_NAME, CONFIG_DIR_NAME, RELEASES_URL } = config;

export default abstract class InteractiveModeLayer30 extends InteractiveModeLayer29 {
  protected renderProjectTrustWarningIfNeeded(): void {
    if (
      this.settingsManager.isProjectTrusted() ||
      !hasTrustRequiringProjectResources(this.sessionManager.getCwd())
    ) {
      return;
    }

    if (this.chatContainer.children.length > 0) {
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(
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

  showNewVersionNotification(release: versionCheckTypes.LatestMsaRelease): void {
    const updateInstruction = () =>
      theme.fg("muted", `New version ${release.version} is available. Run `) +
      theme.fg("accent", `${APP_NAME} update`);
    const changelogUrl = RELEASES_URL;
    const changelogLine = () => {
      const changelogLink = getCapabilities().hyperlinks
        ? hyperlink(theme.fg("accent", changelogUrl), changelogUrl)
        : theme.fg("accent", changelogUrl);
      return theme.fg("muted", "Changelog: ") + changelogLink;
    };

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
      new ThemedText(
        () => `${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction()}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(new ThemedText(changelogLine, 1, 0));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
  }
}
