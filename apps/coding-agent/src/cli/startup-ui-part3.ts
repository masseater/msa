import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import KeybindingsManager from "../core/keybindings-manager.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import systemTheme from "../modes/interactive/theme/system-theme.ts";
import terminalColors from "../modes/interactive/theme/terminal-colors.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import startupUiPart2 from "./startup-ui-part2.ts";

const { awaited, awaiting } = awaitingModule;
const { ProcessTerminal, TuiMainScreen, setCapabilityOverrides, setKeybindings } = tuiModule;
const { initTheme, resolveThemeSetting, setRegisteredThemes } = themeModule;
const { getTerminalTheme, markTerminalColorsPending } = terminalColors;
const { SYSTEM_THEME_NAME } = systemTheme;
const { getAgentDir } = config;
const { loadStartupThemes } = startupUiPart2;

function createStartupTui(
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<tuiTypes.TUI> {
  return Effect.runPromise(
    awaiting(function* () {
      setCapabilityOverrides(settingsManager.terminal.getTerminalCapabilityOverrides());
      setRegisteredThemes(yield* awaited(loadStartupThemes(settingsManager)));

      markTerminalColorsPending();
      initTheme(
        resolveThemeSetting(settingsManager.display.getThemeSetting(), getTerminalTheme()) ??
          SYSTEM_THEME_NAME,
      );
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

const startupUiPart3 = {
  createStartupTui,
};

export default startupUiPart3;
