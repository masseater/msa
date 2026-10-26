import { Function as Fn } from "effect";

import errors from "../../../utils/errors.ts";
import systemTheme from "./system-theme.ts";
import themeLoader from "./theme-loader.ts";
import themeState from "./theme-state.ts";
import themeWatcher from "./theme-watcher.ts";
import type themeTypes from "./theme.types.ts";

const { SYSTEM_THEME_NAME } = systemTheme;
const { selection } = themeState;
type Theme = themeTypes.Theme;

function applyNamedTheme(name: string, enableWatcher: boolean): void {
  selection.currentName = name;
  themeState.setGlobalTheme(themeLoader.loadTheme(name));
  if (enableWatcher) {
    themeWatcher.startThemeWatcher();
  }
}

function fallBackToSystemTheme(): void {
  selection.currentName = SYSTEM_THEME_NAME;
  themeState.setGlobalTheme(themeLoader.loadTheme(SYSTEM_THEME_NAME));
}

const initTheme: {
  (enableWatcher?: boolean): (themeName?: string) => void;
  (themeName?: string, enableWatcher?: boolean): void;
} = Fn.dual(
  (args) => typeof args[0] !== "boolean",
  (themeName?: string, enableWatcher: boolean = false): void => {
    try {
      applyNamedTheme(themeName ?? SYSTEM_THEME_NAME, enableWatcher);
    } catch {
      fallBackToSystemTheme();
    }
  },
);

const setTheme: {
  (enableWatcher?: boolean): (name: string) => { success: boolean; error?: string };
  (name: string, enableWatcher?: boolean): { success: boolean; error?: string };
} = Fn.dual(
  (args) => typeof args[0] === "string",
  (name: string, enableWatcher: boolean = false): { success: boolean; error?: string } => {
    try {
      applyNamedTheme(name, enableWatcher);
      themeState.notifyThemeChange();
      return { success: true };
    } catch (error) {
      fallBackToSystemTheme();
      return { error: errors.toErrorMessage(error), success: false };
    }
  },
);

function setThemeInstance(themeInstance: Theme): void {
  themeState.setGlobalTheme(themeInstance);
  selection.currentName = "<in-memory>";
  themeWatcher.stopThemeWatcher();
  themeState.notifyThemeChange();
}

function onThemeChange(callback: () => void): void {
  selection.onChange = callback;
}

function parseAutoThemeSetting(
  themeSetting: string | undefined,
): { lightTheme: string; darkTheme: string } | undefined {
  if (themeSetting === undefined || themeSetting === "") return undefined;
  const slashIndex = themeSetting.indexOf("/");
  if (slashIndex === -1 || themeSetting.indexOf("/", slashIndex + 1) !== -1) {
    return undefined;
  }
  const lightTheme = themeSetting.slice(0, slashIndex).trim();
  const darkTheme = themeSetting.slice(slashIndex + 1).trim();
  if (lightTheme === "" || darkTheme === "") {
    return undefined;
  }
  return { darkTheme, lightTheme };
}

const resolveThemeSetting: {
  (
    terminalTheme: themeTypes.TerminalTheme,
  ): (themeSetting: string | undefined) => string | undefined;
  (themeSetting: string | undefined, terminalTheme: themeTypes.TerminalTheme): string | undefined;
} = Fn.dual(
  2,
  (
    themeSetting: string | undefined,
    terminalTheme: themeTypes.TerminalTheme,
  ): string | undefined => {
    const autoTheme = parseAutoThemeSetting(themeSetting);
    if (autoTheme !== undefined) {
      return terminalTheme === "light" ? autoTheme.lightTheme : autoTheme.darkTheme;
    }
    if (themeSetting?.includes("/") === true) return undefined;
    return themeSetting;
  },
);

const themeSelection = {
  initTheme,
  onThemeChange,
  parseAutoThemeSetting,
  resolveThemeSetting,
  setTheme,
  setThemeInstance,
};

export default themeSelection;
