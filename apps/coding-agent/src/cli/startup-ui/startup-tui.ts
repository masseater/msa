import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import KeybindingsManager from "../../core/keybindings-manager.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import terminalTheme from "./terminal-theme.ts";

const { performed, awaited, awaiting } = awaitingModule;
const { getAgentDir } = config;
const { ProcessTerminal, TuiMainScreen, setKeybindings, setCapabilityOverrides } = tuiModule;
const { initStartupTheme } = terminalTheme;

function createStartupTui(
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<tuiTypes.TUI> {
  return Effect.runPromise(
    awaiting(function* () {
      setCapabilityOverrides(settingsManager.terminal.getTerminalCapabilityOverrides());
      yield* awaited(initStartupTheme(settingsManager));
      yield* awaited(KeybindingsManager.refresh());
      setKeybindings(KeybindingsManager.create());
      const ui: tuiTypes.TUI = new TuiMainScreen(
        new ProcessTerminal(),
        settingsManager.terminal.getShowHardwareCursor(),
        getAgentDir(),
      );
      ui.setClearOnShrink(settingsManager.terminal.getClearOnShrink());
      return ui;
    }),
  );
}

function clearStartupTui(ui: tuiTypes.TUI): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      ui.clear();
      ui.requestRender();
      yield* performed(Effect.sleep(25));
    }),
  );
}

const startupTui = {
  clearStartupTui,
  createStartupTui,
};

export default startupTui;
