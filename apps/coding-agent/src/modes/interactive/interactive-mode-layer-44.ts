import { Effect } from "effect";

import accounts from "../../core/accounts.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer43 from "./interactive-mode-layer-43.ts";

const { runAccountsCommand } = accounts;

export default abstract class InteractiveModeLayer44 extends InteractiveModeLayer43 {
  protected builtinArgumentCommands(): Record<string, interactiveModeInternalTypes.BuiltinCommand> {
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
            refreshProviders: () => this.refreshProvidersAfterAccounts(),
            ui: this.createExtensionUIContext(),
          }),
        ),
      ),
      "/bug": entry(true, (text) => this.handleBugCommand(bugHint(text))),
      "/compact": entry(true, (text) => this.handleCompactCommand(argument(text, "/compact"))),
      "/effort": entry(true, (text) =>
        Effect.sync(() => this.handleThinkingCommand(argument(text, "/effort"))),
      ),
      "/export": entry(false, (text) => this.handleExportCommand(text)),
      "/import": entry(false, (text) => Effect.promise(() => this.handleImportCommand(text))),
      "/login": entry(true, (text) =>
        Effect.promise(() => this.loginFlow.login(argument(text, "/login"))),
      ),
      "/model": entry(true, (text) => this.handleModelCommand(argument(text, "/model"))),
      "/rename": entry(false, (text) => Effect.sync(() => this.handleNameCommand(text))),
    };
  }
}
