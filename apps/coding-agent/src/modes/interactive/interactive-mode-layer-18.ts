import tuiModule from "@msa/tui";

import config from "../../config.ts";
import slashCommandsModule from "../../core/slash-commands.ts";
import changelog from "../../utils/changelog.ts";
import type toolsManagerTypes from "../../utils/tools-manager.types.ts";
import DynamicBorder from "./components/dynamic-border.ts";
import ThemedText from "./components/themed-text.ts";
import hotkeys from "./hotkeys.ts";
import InteractiveModeLayer17 from "./interactive-mode-layer-17.ts";
import themeModule from "./theme/theme.ts";

const { Markdown, Spacer, Text } = tuiModule;
const { theme } = themeModule;
const { APP_NAME } = config;
const { getChangelogPath, normalizeChangelogLinks, parseChangelog } = changelog;
const { formatHelpMarkdown, isBuiltinSlashCommandName, withSkillCommands } = slashCommandsModule;
const { formatHotkeysMarkdown } = hotkeys;

export default abstract class InteractiveModeLayer18 extends InteractiveModeLayer17 {
  protected showStartupNoticesIfNeeded(): void {
    if (this.startupNoticesShown) {
      return;
    }
    this.startupNoticesShown = true;

    if (this.changelogMarkdown === undefined || this.changelogMarkdown === "") {
      return;
    }

    if (this.chatContainer.children.length > 0) {
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder());
    if (this.settingsManager.getCollapseChangelog()) {
      const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/u);
      const latestVersion = versionMatch === null ? this.version : versionMatch[1];
      const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/release-notes")} to view full changelog.`;
      this.chatContainer.addChild(new Text(condensedText, 1, 0));
    } else {
      this.chatContainer.addChild(
        new ThemedText(() => theme.bold(theme.fg("accent", "What's New")), 1, 0),
      );
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
      );
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder());
  }

  protected showManagedToolStatus(status: toolsManagerTypes.ToolStatus): void {
    if (!this.managedToolStatusStarted) {
      this.chatContainer.addChild(new Spacer(1));
      this.managedToolStatusStarted = true;
    }
    const message = status.type === "warning" ? `Warning: ${status.message}` : status.message;
    const color = status.type === "warning" ? "warning" : "dim";
    this.chatContainer.addChild(new ThemedText(() => theme.fg(color, message), 1, 0));
    this.lastStatusSpacer = undefined;
    this.lastStatusText = undefined;
    this.ui.requestRender();
  }

  showPackageUpdateNotification(packages: string[]): void {
    const updateInstruction = () =>
      theme.fg("muted", "Package updates are available. Run ") +
      theme.fg("accent", `${APP_NAME} update --extensions`);
    const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
      new ThemedText(
        () =>
          `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction()}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
  }

  protected handleChangelogCommand(): void {
    const changelogPath = getChangelogPath();
    const allEntries = parseChangelog(changelogPath);

    const changelogMarkdown =
      allEntries.length > 0
        ? allEntries
            .reverse()
            .map((e) => normalizeChangelogLinks(e.content, e))
            .join("\n\n")
        : "No changelog entries found.";

    this.addMarkdownPanel("What's New", changelogMarkdown);
  }

  protected addMarkdownPanel(title: string, markdown: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(new ThemedText(() => theme.bold(theme.fg("accent", title)), 1, 0));
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Markdown(markdown, 1, 1, this.getMarkdownThemeWithSettings()));
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  protected handleHelpCommand(): void {
    const commands = [
      ...this.session.extensions.binding.extensionRunner
        .getRegisteredCommands()
        .filter((command) => !isBuiltinSlashCommandName(command.name))
        .map((command) => ({ description: command.description, name: command.invocationName })),
      ...this.session.promptTemplates,
    ];
    const skills = this.settingsManager.getEnableSkillCommands()
      ? this.session.resourceLoader.getSkills().skills
      : [];
    this.addMarkdownPanel("Commands", formatHelpMarkdown(withSkillCommands(commands, skills)));
  }

  protected handleHotkeysCommand(): void {
    const shortcuts = this.session.extensions.binding.extensionRunner.getShortcuts(
      this.keybindings.getEffectiveConfig(),
    );
    this.addMarkdownPanel("Keyboard Shortcuts", formatHotkeysMarkdown(shortcuts));
  }
}
