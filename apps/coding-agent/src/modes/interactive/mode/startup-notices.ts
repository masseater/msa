import tuiModule from "@msa/tui";

import config from "../../../config.ts";
import changelog from "../../../utils/changelog.ts";
import type versionCheckTypes from "../../../utils/version-check.types.ts";
import DynamicBorder from "../components/dynamic-border.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { APP_NAME, VERSION, RELEASES_URL } = config;
const { Spacer, Markdown, Text, getCapabilities, hyperlink } = tuiModule;
const { getChangelogPath, getNewEntries, normalizeChangelogLinks, parseChangelog } = changelog;

export default class StartupNotices {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  changelogMarkdown: string | undefined = undefined;

  private startupNoticesShown = false;

  getChangelogForDisplay(): Promise<string | undefined> {
    if (this.mode.session.state.messages.length > 0) {
      return Promise.resolve(undefined);
    }
    return parseChangelog(getChangelogPath()).then((entries) => this.changelogSince(entries));
  }

  private changelogSince(entries: Awaited<ReturnType<typeof parseChangelog>>): string | undefined {
    const lastVersion = this.mode.settingsManager.display.getLastChangelogVersion();

    if (lastVersion === undefined || lastVersion === "") {
      this.mode.settingsManager.display.setLastChangelogVersion(VERSION);
      return undefined;
    }

    const newEntries = getNewEntries(entries, lastVersion);
    if (newEntries.length > 0) {
      this.mode.settingsManager.display.setLastChangelogVersion(VERSION);
      return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
    }

    return undefined;
  }

  showStartupNoticesIfNeeded(): void {
    if (this.startupNoticesShown) {
      return;
    }
    this.startupNoticesShown = true;

    if (this.changelogMarkdown === undefined || this.changelogMarkdown === "") {
      return;
    }

    if (this.mode.layout.chatContainer.children.length > 0) {
      this.mode.layout.chatContainer.addChild(new Spacer(1));
    }
    this.mode.layout.chatContainer.addChild(new DynamicBorder());
    if (this.mode.settingsManager.display.getCollapseChangelog()) {
      const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/u);
      const latestVersion = versionMatch === null ? VERSION : versionMatch[1];
      const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/release-notes")} to view full changelog.`;
      this.mode.layout.chatContainer.addChild(new Text(condensedText, 1, 0));
    } else {
      this.mode.layout.chatContainer.addChild(
        new ThemedText(() => theme.bold(theme.fg("accent", "What's New")), 1, 0),
      );
      this.mode.layout.chatContainer.addChild(new Spacer(1));
      this.mode.layout.chatContainer.addChild(
        new Markdown(
          this.changelogMarkdown.trim(),
          1,
          0,
          this.mode.view.messages.getMarkdownThemeWithSettings(),
        ),
      );
      this.mode.layout.chatContainer.addChild(new Spacer(1));
    }
    this.mode.layout.chatContainer.addChild(new DynamicBorder());
  }

  showPackageUpdateNotification(packages: string[]): void {
    const updateInstruction = () =>
      theme.fg("muted", "Package updates are available. Run ") +
      theme.fg("accent", `${APP_NAME} update --extensions`);
    const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () =>
          `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction()}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
        1,
        0,
      ),
    );
    this.mode.layout.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.mode.ui.requestRender();
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

    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () => `${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction()}`,
        1,
        0,
      ),
    );
    this.mode.layout.chatContainer.addChild(new ThemedText(changelogLine, 1, 0));
    this.mode.layout.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.mode.ui.requestRender();
  }
}
