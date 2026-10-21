import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import systemTheme from "../../modes/interactive/theme/system-theme.ts";
import terminalColors from "../../modes/interactive/theme/terminal-colors.ts";
import themeController from "../../modes/interactive/theme/theme-controller.ts";
import themeModule from "../../modes/interactive/theme/theme.ts";
import startupThemes from "./startup-themes.ts";

const { awaited, awaiting } = awaitingModule;
const { setTerminalColors, getTerminalTheme, markTerminalColorsPending } = terminalColors;
const { requestTerminalColors } = themeController;
const { setTheme, resolveThemeSetting, initTheme, setRegisteredThemes } = themeModule;
const { SYSTEM_THEME_NAME } = systemTheme;
const { loadStartupThemes } = startupThemes;

function initStartupTheme(settingsManager: settingsManagerTypes.SettingsManager): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      setRegisteredThemes(yield* awaited(loadStartupThemes(settingsManager)));
      markTerminalColorsPending();
      initTheme(
        resolveThemeSetting(settingsManager.display.getThemeSetting(), getTerminalTheme()) ??
          SYSTEM_THEME_NAME,
      );
    }),
  );
}

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

const terminalTheme = { initStartupTheme, queryStartupTerminalColors, startStartupTui };

export default terminalTheme;
