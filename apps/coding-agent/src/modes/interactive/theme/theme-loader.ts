import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Function as Fn } from "effect";

import systemTheme from "./system-theme.ts";
import terminalColorsModule from "./terminal-colors.ts";
import Theme from "./theme-class.ts";
import themeColorTokens from "./theme-color-tokens.ts";
import themeJsonModule from "./theme-json.ts";
import type themeSchemaTypes from "./theme-schema.types.ts";
import themeState from "./theme-state.ts";

const { getTerminalColors, getTerminalTheme, terminalColorsArePending } = terminalColorsModule;
const { splitThemeColors, withThemeTokenFallbacks } = themeColorTokens;
const { SYSTEM_THEME_NAME, generateSystemThemeColors } = systemTheme;
const { loadThemeJson, readThemeFile, resolveThemeColors } = themeJsonModule;
const { getTerminalColorMode } = tui;

function createTheme(
  themeJson: themeSchemaTypes.ValidatedThemeJson,
  mode?: tuiTypes.TerminalColorMode,
  sourcePath?: string,
): Theme {
  const colorMode = mode ?? getTerminalColorMode();
  const resolvedColors = withThemeTokenFallbacks(
    resolveThemeColors(themeJson.colors, themeJson.vars),
  );
  const { fgColors, bgColors } = splitThemeColors(resolvedColors);
  return new Theme(fgColors, bgColors, colorMode, {
    appearance: themeJson.appearance,
    name: themeJson.name,
    sourceJson: themeJson,
    sourcePath,
  });
}

function createSystemTheme(mode?: tuiTypes.TerminalColorMode): Theme {
  const generated = generateSystemThemeColors({
    ...getTerminalColors(),
    appearanceHint: getTerminalTheme(),
    saturation: terminalColorsArePending() ? 0 : 1,
  });
  const { fgColors, bgColors } = splitThemeColors(withThemeTokenFallbacks(generated.colors));
  return new Theme(fgColors, bgColors, mode ?? getTerminalColorMode(), {
    appearance: generated.appearance,
    dim: generated.dim,
    name: SYSTEM_THEME_NAME,
  });
}

const loadThemeFromPath: {
  (mode?: tuiTypes.TerminalColorMode): (themePath: string) => Promise<Theme>;
  (themePath: string, mode?: tuiTypes.TerminalColorMode): Promise<Theme>;
} = Fn.dual(
  (args) => typeof args[0] === "string" && args[0] !== "truecolor" && args[0] !== "256color",
  (themePath: string, mode?: tuiTypes.TerminalColorMode): Promise<Theme> =>
    readThemeFile(themePath).then((json) => createTheme(json, mode, themePath)),
);

type LoadedTheme = Parameters<typeof themeState.setGlobalTheme>[0];

function loadTheme(name: string, mode?: tuiTypes.TerminalColorMode): LoadedTheme {
  if (name === SYSTEM_THEME_NAME) return createSystemTheme(mode);
  const registeredTheme = themeState.registeredThemes.get(name);
  if (registeredTheme !== undefined) {
    return registeredTheme;
  }
  return createTheme(loadThemeJson(name), mode);
}

function getThemeByName(name: string): LoadedTheme | undefined {
  try {
    return loadTheme(name);
  } catch {
    return undefined;
  }
}

const themeLoader = {
  getThemeByName,
  loadTheme,
  loadThemeFromPath,
};

export default themeLoader;
