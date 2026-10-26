import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import slashCommandsModule from "../../../core/slash-commands.ts";
import changelog from "../../../utils/changelog.ts";
import clipboard from "../../../utils/clipboard.ts";
import errorsModule from "../../../utils/errors.ts";
import bugReport from "../bug-report.ts";
import hotkeys from "../hotkeys.ts";
import type InteractiveMode from "../interactive-mode.ts";
const { isBuiltinSlashCommandName, withSkillCommands, formatHelpMarkdown } = slashCommandsModule;
const { TuiAltScreen } = tuiModule;
const { awaited, awaitingWith } = awaitingModule;
const { copyToClipboard } = clipboard;
const { toErrorMessage } = errorsModule;
const { reportBug } = bugReport;
const { getChangelogPath, normalizeChangelogLinks, parseChangelog } = changelog;
const { formatHotkeysMarkdown } = hotkeys;

export default class InfoCommands {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  handleBugCommand(hint: string | undefined): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(
        reportBug(
          {
            editorSlot: this.mode.editorSlot,
            keybindings: this.mode.keybindings,
            session: this.mode.session,
            showError: (message) => this.mode.display.status.showError(message),
            showStatus: (message) => this.mode.display.status.showStatus(message),
            ui: this.mode.ui,
          },
          hint,
        ),
      );
    }, this);
  }

  handleChangelogCommand(): Promise<void> {
    return parseChangelog(getChangelogPath()).then((allEntries) => this.showChangelog(allEntries));
  }

  private showChangelog(allEntries: Awaited<ReturnType<typeof parseChangelog>>): void {
    const changelogMarkdown =
      allEntries.length > 0
        ? allEntries
            .reverse()
            .map((e) => normalizeChangelogLinks(e.content, e))
            .join("\n\n")
        : "No changelog entries found.";

    this.mode.view.panels.addMarkdownPanel("What's New", changelogMarkdown);
  }

  handleHelpCommand(): void {
    const commands = [
      ...this.mode.session.extensions.binding.extensionRunner
        .getRegisteredCommands()
        .filter((command) => !isBuiltinSlashCommandName(command.name))
        .map((command) => ({ description: command.description, name: command.invocationName })),
      ...this.mode.session.promptTemplates,
    ];
    const skills = this.mode.settingsManager.resources.getEnableSkillCommands()
      ? this.mode.session.resourceLoader.getSkills().skills
      : [];
    this.mode.view.panels.addMarkdownPanel(
      "Commands",
      formatHelpMarkdown(withSkillCommands(commands, skills)),
    );
  }

  handleHotkeysCommand(): void {
    const shortcuts = this.mode.session.extensions.binding.extensionRunner.getShortcuts(
      this.mode.keybindings.getEffectiveConfig(),
    );
    this.mode.view.panels.addMarkdownPanel("Keyboard Shortcuts", formatHotkeysMarkdown(shortcuts));
  }

  handleCopyCommand(
    options: { flashConfirmation?: boolean; preferSelection?: boolean } = {},
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { renderer } = this.mode.lifecycle.screen;
        if (
          options.preferSelection === true &&
          renderer instanceof TuiAltScreen &&
          !renderer.getCopyOnSelect() &&
          renderer.hasActiveSelection()
        ) {
          yield* awaited(renderer.copyActiveSelectionToClipboard());
          return;
        }

        const text = this.mode.session.context.transcript.getLastAssistantText();
        if (text === undefined || text === "") {
          this.mode.display.status.showError("No agent messages to copy yet.");
          return;
        }

        try {
          yield* awaited(copyToClipboard(text));
          const current = this.mode.lifecycle.screen.renderer;
          if (options.flashConfirmation === true && current instanceof TuiAltScreen) {
            current.flash("Copied!");
          } else {
            this.mode.display.status.showStatus("Copied last agent message to clipboard");
          }
        } catch (error) {
          this.mode.display.status.showError(toErrorMessage(error));
        }
      }, this),
    );
  }
}
