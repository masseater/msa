import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import systemTheme from "../modes/interactive/theme/system-theme.ts";
import terminalColors from "../modes/interactive/theme/terminal-colors.ts";
import themeController from "../modes/interactive/theme/theme-controller.ts";
import themeModule from "../modes/interactive/theme/theme.ts";

const { requestTerminalColors } = themeController;
const { getTerminalTheme, setTerminalColors } = terminalColors;
const { resolveThemeSetting, setTheme } = themeModule;
const { SYSTEM_THEME_NAME } = systemTheme;
const { awaiting, performed } = awaitingModule;

function startStartupTuiImpl(
  ui: tuiTypes.TUI,
  settingsManager: settingsManagerTypes.SettingsManager,
): void {
  ui.start();
  const themeSetting = settingsManager.display.getThemeSetting();
  queryStartupTerminalColors(ui, () => {
    setTheme(resolveThemeSetting(themeSetting, getTerminalTheme()) ?? SYSTEM_THEME_NAME);
  });
}

const startStartupTui: {
  (ui: tuiTypes.TUI, settingsManager: settingsManagerTypes.SettingsManager): void;
  (settingsManager: settingsManagerTypes.SettingsManager): (ui: tuiTypes.TUI) => void;
} = dual((args: IArguments) => args.length >= 2, startStartupTuiImpl);

function queryStartupTerminalColors(ui: tuiTypes.TUI, onColors: () => void): void {
  void requestTerminalColors(ui, (colors) => {
    setTerminalColors(colors);
    onColors();
    ui.invalidate();
    ui.requestRender();
  });
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

const startupUiPart4 = {
  clearStartupTui,
  queryStartupTerminalColors,
  startStartupTui,
};

export default startupUiPart4;
