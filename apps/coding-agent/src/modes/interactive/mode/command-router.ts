import { Effect } from "effect";

import accounts from "../../../core/accounts.ts";
import awaitingModule from "../../../core/awaiting.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { syncCommand, promiseCommand } = interactiveModeHelpers;
const { awaitingWith, performed } = awaitingModule;
const { runAccountsCommand } = accounts;

export default class BuiltinCommandRouter {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
    if (text === command) {
      return undefined;
    }
    if (!text.startsWith(`${command} `)) {
      return undefined;
    }

    const argsString = text.slice(command.length + 1).trimStart();
    if (argsString === "") {
      return undefined;
    }

    const firstChar = argsString[0];
    if (firstChar === '"' || firstChar === "'") {
      const closingQuoteIndex = argsString.indexOf(firstChar, 1);
      if (closingQuoteIndex < 0) {
        return undefined;
      }
      return argsString.slice(1, closingQuoteIndex);
    }

    const firstWhitespaceIndex = argsString.search(/\s/u);
    if (firstWhitespaceIndex < 0) {
      return argsString;
    }
    return argsString.slice(0, firstWhitespaceIndex);
  }

  private builtinViewCommands(): Record<string, interactiveModeInternalTypes.BuiltinCommand> {
    const after = (run: () => void) => ({ args: false, clearFirst: false, run: syncCommand(run) });
    return {
      "/config": after(() => this.mode.selectors.settings.showSettingsSelector()),
      "/debug": after(() => void this.mode.commands.debug.handleDebugCommand()),
      "/fork": after(() => this.mode.selectors.fork.showUserMessageSelector()),
      "/help": after(() => this.mode.commands.info.handleHelpCommand()),
      "/keybindings": after(() => this.mode.commands.info.handleHotkeysCommand()),
      "/logout": after(() => void this.mode.models.login.loginFlow.logouts.logout()),
      "/memory": after(() => this.mode.selectors.views.showMemoryView()),
      "/release-notes": after(() => void this.mode.commands.info.handleChangelogCommand()),
      "/resume": after(() => this.mode.selectors.sessions.showSessionSelector()),
      "/rewind": after(() => this.mode.selectors.tree.showTreeSelector()),
      "/tasks": after(() => this.mode.selectors.views.showTasksView()),
      "/threads": after(() => this.mode.selectors.views.showTasksView()),
      "/trust": after(() => void this.mode.selectors.trust.showTrustSelector()),
    };
  }

  private builtinArgumentCommands(): Record<string, interactiveModeInternalTypes.BuiltinCommand> {
    const entry = (clearFirst: boolean, run: (text: string) => Effect.Effect<unknown>) => ({
      args: true,
      clearFirst,
      run,
    });
    const argument = (text: string, name: string) =>
      text.startsWith(`${name} `) ? text.slice(name.length + 1).trim() : undefined;
    const bugHint = (text: string) => {
      const hint = text.slice("/bug".length).trim();
      return hint === "" ? undefined : hint;
    };
    return {
      "/accounts": entry(true, (text) =>
        Effect.promise(() =>
          runAccountsCommand(text.slice("/accounts".length), {
            refreshProviders: () => this.mode.input.autocomplete.refreshProvidersAfterAccounts(),
            ui: this.mode.extensions.ui.createExtensionUIContext(),
          }),
        ),
      ),
      "/bug": entry(true, (text) => this.mode.commands.info.handleBugCommand(bugHint(text))),
      "/compact": entry(true, (text) =>
        this.mode.commands.session.handleCompactCommand(argument(text, "/compact")),
      ),
      "/effort": entry(true, (text) =>
        Effect.sync(() =>
          this.mode.models.thinking.handleThinkingCommand(argument(text, "/effort")),
        ),
      ),
      "/export": entry(false, (text) => this.mode.commands.session.handleExportCommand(text)),
      "/import": entry(false, (text) =>
        Effect.promise(() => this.mode.commands.importer.handleImportCommand(text)),
      ),
      "/login": entry(true, (text) =>
        Effect.promise(() => this.mode.models.login.loginFlow.login(argument(text, "/login"))),
      ),
      "/model": entry(true, (text) =>
        this.mode.models.selector.handleModelCommand(argument(text, "/model")),
      ),
      "/rename": entry(false, (text) =>
        Effect.sync(() => this.mode.commands.session.handleNameCommand(text)),
      ),
    };
  }

  private builtinSessionCommands(): Record<string, interactiveModeInternalTypes.BuiltinCommand> {
    const entry = (clearFirst: boolean, run: () => Effect.Effect<void>) => ({
      args: false,
      clearFirst,
      run,
    });
    return {
      "/branch": entry(
        true,
        promiseCommand(() => this.mode.commands.session.handleCloneCommand()),
      ),
      "/clear": entry(true, () => this.mode.commands.session.handleClearCommand()),
      "/copy": entry(
        false,
        promiseCommand(() => this.mode.commands.info.handleCopyCommand()),
      ),
      "/exit": entry(
        true,
        promiseCommand(() => this.mode.lifecycle.shutdown.shutdown()),
      ),
      "/reload": entry(
        true,
        promiseCommand(() => this.mode.commands.reload.handleReloadCommand()),
      ),
      "/scoped-models": entry(
        true,
        syncCommand(() => this.mode.models.scoped.showModelsSelector()),
      ),
      "/share": entry(false, () => this.mode.commands.session.handleShareCommand()),
      "/status": entry(
        true,
        promiseCommand(() => this.mode.commands.sessionInfo.handleSessionCommand()),
      ),
    };
  }

  handleBuiltinCommand(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const space = text.indexOf(" ");
      const name = space === -1 ? text : text.slice(0, space);
      const commands = {
        ...this.builtinViewCommands(),
        ...this.builtinSessionCommands(),
        ...this.builtinArgumentCommands(),
      };
      const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
      if (command === undefined || (space !== -1 && !command.args)) return false;
      if (command.clearFirst) this.mode.editor.setText("");
      yield* performed(command.run(text));
      if (!command.clearFirst) this.mode.editor.setText("");
      return true;
    }, this);
  }
}
