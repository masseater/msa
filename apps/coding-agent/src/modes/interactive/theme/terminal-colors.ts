import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import processEnv from "../../../core/process-env.ts";
import systemTheme from "./system-theme.ts";
import type themeTypes from "./theme.types.ts";

const { terminalAppearance } = systemTheme;
const { envSnapshot } = processEnv;
let terminalColors: tuiTypes.TerminalColors = {};
let terminalColorsPending = false;
let terminalColorScheme: themeTypes.TerminalTheme | undefined;

function setTerminalColors(colors: tuiTypes.TerminalColors): void {
  terminalColors = { ...colors };
  terminalColorsPending = false;
}

function setTerminalColorScheme(scheme: themeTypes.TerminalTheme | undefined): void {
  terminalColorScheme = scheme;
}

function markTerminalColorsPending(): void {
  terminalColorsPending = true;
}

function getTerminalColors(): tuiTypes.TerminalColors {
  return terminalColors;
}

function terminalColorsArePending(): boolean {
  return terminalColorsPending;
}

function detectColorFgBgTheme(
  env: NodeJS.ProcessEnv = envSnapshot(),
): themeTypes.TerminalTheme | undefined {
  const bg = env["COLORFGBG"]?.split(";").at(-1)?.trim();
  if (bg === undefined || bg === "" || !/^\d{1,2}$/u.test(bg)) return undefined;
  const index = Number(bg);
  if (index > 15) return undefined;
  return index <= 6 || index === 8 ? "dark" : "light";
}

const detectTerminalTheme: {
  (
    reportedScheme?: themeTypes.TerminalTheme,
    env?: NodeJS.ProcessEnv,
  ): (colors?: tuiTypes.TerminalColors) => themeTypes.TerminalTheme;
  (
    colors?: tuiTypes.TerminalColors,
    reportedScheme?: themeTypes.TerminalTheme,
    env?: NodeJS.ProcessEnv,
  ): themeTypes.TerminalTheme;
} = dual(
  (args) =>
    (typeof args[0] === "object" && args[0] !== null) ||
    (args[0] === undefined && typeof args[1] !== "object"),
  (
    colors: tuiTypes.TerminalColors = {},
    reportedScheme?: themeTypes.TerminalTheme,
    env: NodeJS.ProcessEnv = envSnapshot(),
  ): themeTypes.TerminalTheme => {
    const { background, foreground } = colors;
    if (background !== undefined) return terminalAppearance(background, foreground);
    return reportedScheme ?? detectColorFgBgTheme(env) ?? "dark";
  },
);

function getTerminalTheme(): themeTypes.TerminalTheme {
  return detectTerminalTheme(terminalColors, terminalColorScheme);
}

const terminalColorsModule = {
  detectColorFgBgTheme,
  detectTerminalTheme,
  getTerminalColors,
  getTerminalTheme,
  markTerminalColorsPending,
  setTerminalColorScheme,
  setTerminalColors,
  terminalColorsArePending,
};

export default terminalColorsModule;
