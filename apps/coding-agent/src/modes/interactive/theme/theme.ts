import * as fs from "node:fs";

import chalk from "chalk";

import { getCustomThemesDir, getThemesDir } from "../../../config.ts";
import { envSnapshot } from "../../../core/process-env.ts";
import type { SourceInfo } from "../../../core/source-info.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { closeWatcher, watchWithErrorHandler } from "../../../utils/fs-watch.ts";
import { highlight, supportsLanguage } from "../../../utils/syntax-highlight.ts";
import { stripBom } from "../../../utils/text.ts";
import {
  SYSTEM_THEME_NAME,
  generateSystemThemeColors,
  terminalAppearance,
} from "./system-theme.ts";
import {
  type ResolvedThemeColorValues,
  THEME_TOKENS,
  type ThemeBg,
  type ThemeColor,
  type ThemeColorValues,
  type ThemeToken,
} from "./theme-tokens.ts";

export { SYSTEM_THEME_NAME } from "./system-theme.ts";

import type agentTypes from "@msa/agent-core/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import { schedule, type Scheduled } from "../../../core/platform.ts";
import { join } from "../../path.ts";
import type {
  ThemeColorValue as ColorValue,
  ValidatedThemeJson as ThemeJson,
} from "./theme-schema.ts";

const {
  backgroundAnsi,
  colorToHex,
  colorToOklch,
  foregroundAnsi,
  getTerminalColorMode,
  indexedColor,
  mixColors,
  parseColor,
  rgbColor,
  styleTextWithAnsi,
} = tui;

export type { ValidatedThemeJson as ThemeJson } from "./theme-schema.ts";
export type { ThemeBg, ThemeColor, ThemeToken } from "./theme-tokens.ts";

export interface ThemeStyle extends tuiTypes.TextAttributes {
  fg?: ThemeColor | tuiTypes.Color;
  bg?: ThemeBg | tuiTypes.Color;
}

export type ThemeJsonValidator = (label: string, json: unknown) => ThemeJson;

let themeJsonValidator: ThemeJsonValidator | undefined;

export function setThemeJsonValidator(validator: ThemeJsonValidator): void {
  themeJsonValidator = validator;
}

function resolveVarRefs(
  value: ColorValue,
  vars: Record<string, ColorValue>,
  visited = new Set<string>(),
): string | number {
  if (
    typeof value === "number" ||
    value === "" ||
    value.startsWith("#") ||
    /^ok(lch|hsl)\(/iu.test(value)
  ) {
    return value;
  }
  if (visited.has(value)) {
    throw new Error(`Circular variable reference detected: ${value}`);
  }
  const reference = vars[value];
  if (reference === undefined) {
    throw new Error(`Variable reference not found: ${value}`);
  }
  visited.add(value);
  return resolveVarRefs(reference, vars, visited);
}

function resolveThemeColors<T extends Record<string, ColorValue>>(
  colors: T,
  vars: Record<string, ColorValue> = {},
): Record<keyof T, string | number> {
  const resolved: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveVarRefs(value, vars);
  }
  return resolved as Record<keyof T, string | number>;
}

function withThemeTokenFallbacks<Value>(
  values: ThemeColorValues<Value>,
): ResolvedThemeColorValues<Value> {
  const resolved = { ...values } as Partial<ResolvedThemeColorValues<Value>>;
  for (const [rawName, descriptor] of Object.entries(THEME_TOKENS)) {
    if (!("fallback" in descriptor)) continue;
    const name = rawName as ThemeToken;
    if (resolved[name] !== undefined) continue;
    const fallback = descriptor.fallback as ThemeToken;
    const fallbackValue = resolved[fallback];
    if (fallbackValue === undefined) {
      throw new Error(`Theme token ${rawName} has unresolved fallback ${descriptor.fallback}`);
    }
    resolved[name] = fallbackValue;
  }
  return resolved as ResolvedThemeColorValues<Value>;
}

export type ThemeAppearance = TerminalTheme;

let terminalColors: tuiTypes.TerminalColors = {};
let terminalColorsPending = false;
let terminalColorScheme: TerminalTheme | undefined;

export function setTerminalColors(colors: tuiTypes.TerminalColors): void {
  terminalColors = { ...colors };
  terminalColorsPending = false;
}

export function setTerminalColorScheme(scheme: TerminalTheme | undefined): void {
  terminalColorScheme = scheme;
}

export function markTerminalColorsPending(): void {
  terminalColorsPending = true;
}

const GUESSED_DEFAULT_COLORS: Record<
  ThemeAppearance,
  { foreground: tuiTypes.Color; background: tuiTypes.Color }
> = {
  dark: { background: parseColor("#000000"), foreground: parseColor("#e5e5e7") },
  light: { background: parseColor("#ffffff"), foreground: parseColor("#000000") },
};

function averageLightness(colors: tuiTypes.Color[]): number | undefined {
  const fixed = colors.filter((color) => color.kind !== "indexed" || color.index >= 16);
  if (fixed.length === 0) return undefined;
  return fixed.reduce((sum, color) => sum + colorToOklch(color).l, 0) / fixed.length;
}

function detectAppearance(
  foregrounds: tuiTypes.Color[],
  backgrounds: tuiTypes.Color[],
): ThemeAppearance | undefined {
  const fg = averageLightness(foregrounds);
  const bg = averageLightness(backgrounds);
  if (fg !== undefined && bg !== undefined) return bg < fg ? "dark" : "light";
  if (bg !== undefined) return bg < 0.5 ? "dark" : "light";
  if (fg !== undefined) return fg > 0.5 ? "dark" : "light";
  return undefined;
}

export class Theme {
  readonly name?: string | undefined;
  readonly sourcePath?: string | undefined;
  sourceInfo?: SourceInfo | undefined;
  private mode: tuiTypes.TerminalColorMode;
  private readonly fgAnsi = new Map<ThemeColor, string>();
  private readonly bgAnsi = new Map<ThemeBg, string>();
  private readonly concreteColors: Partial<Record<ThemeToken, tuiTypes.Color>> = {};
  private readonly defaultForegroundTokens: ThemeToken[] = [];
  private readonly defaultBackgroundTokens: ThemeToken[] = [];
  private readonly dimTokens: ReadonlySet<ThemeColor>;
  private readonly ownAppearance: ThemeAppearance | undefined;
  private resolvedColors:
    | { terminal: tuiTypes.TerminalColors; colors: Readonly<Record<ThemeToken, tuiTypes.Color>> }
    | undefined;

  constructor(
    fgColors: Pick<ThemeColorValues<string | number>, ThemeColor>,
    bgColors: Pick<ThemeColorValues<string | number>, ThemeBg>,
    mode: tuiTypes.TerminalColorMode,
    options: {
      name?: string | undefined;
      sourcePath?: string | undefined;
      sourceInfo?: SourceInfo | undefined;
      appearance?: ThemeAppearance | undefined;
      dim?: readonly ThemeColor[] | undefined;
    } = {},
  ) {
    this.name = options.name;
    this.sourcePath = options.sourcePath;
    this.sourceInfo = options.sourceInfo;
    this.mode = mode;
    this.dimTokens = new Set(options.dim);
    const { fgColors: foregrounds, bgColors: backgrounds } = splitThemeColors(
      withThemeTokenFallbacks({ ...fgColors, ...bgColors }),
    );
    const concreteForegrounds: tuiTypes.Color[] = [];
    const concreteBackgrounds: tuiTypes.Color[] = [];
    const addToken = (token: ThemeToken, value: string | number, isBackground: boolean): string => {
      if (value === "") {
        (isBackground ? this.defaultBackgroundTokens : this.defaultForegroundTokens).push(token);
        return isBackground ? "\x1b[49m" : "\x1b[39m";
      }
      const color = parseColor(value);
      this.concreteColors[token] = color;
      (isBackground ? concreteBackgrounds : concreteForegrounds).push(color);
      return isBackground ? backgroundAnsi(color, mode) : foregroundAnsi(color, mode);
    };
    for (const [token, value] of Object.entries(foregrounds) as [ThemeColor, string | number][]) {
      this.fgAnsi.set(token, addToken(token, value, false));
    }
    for (const [token, value] of Object.entries(backgrounds) as [ThemeBg, string | number][]) {
      this.bgAnsi.set(token, addToken(token, value, true));
    }
    this.ownAppearance =
      options.appearance ?? detectAppearance(concreteForegrounds, concreteBackgrounds);
  }

  get appearance(): ThemeAppearance {
    return this.ownAppearance ?? getTerminalTheme();
  }

  get colors(): Readonly<Record<ThemeToken, tuiTypes.Color>> {
    const terminal = terminalColors;
    if (this.resolvedColors?.terminal !== terminal) {
      const guess = GUESSED_DEFAULT_COLORS[this.appearance];
      const toColor = (rgb: tuiTypes.RgbColor | undefined, fallback: tuiTypes.Color) =>
        rgb === undefined ? fallback : rgbColor(rgb.r, rgb.g, rgb.b);
      const foreground = toColor(terminal.foreground, guess.foreground);
      const background = toColor(terminal.background, guess.background);
      const colors = { ...this.concreteColors };
      for (const token of this.defaultForegroundTokens) colors[token] = foreground;
      for (const token of this.defaultBackgroundTokens) colors[token] = background;
      for (const token of this.dimTokens) {
        const color = colors[token];
        if (color !== undefined) colors[token] = mixColors(color, background, 0.4);
      }
      this.resolvedColors = {
        colors: Object.freeze(colors as Record<ThemeToken, tuiTypes.Color>),
        terminal,
      };
    }
    return this.resolvedColors.colors;
  }

  style(text: string, options: ThemeStyle): string {
    const { fg, bg } = options;
    if (typeof fg === "string" && this.dimTokens.has(fg)) options = { ...options, dim: true };
    return styleTextWithAnsi(
      text,
      fg === undefined
        ? undefined
        : typeof fg === "string"
          ? this.tokenAnsi(this.fgAnsi, fg)
          : foregroundAnsi(fg, this.mode),
      bg === undefined
        ? undefined
        : typeof bg === "string"
          ? this.tokenAnsi(this.bgAnsi, bg)
          : backgroundAnsi(bg, this.mode),
      options,
    );
  }

  fg(color: ThemeColor, text: string): string {
    const ansi = this.tokenAnsi(this.fgAnsi, color);
    if (this.dimTokens.has(color)) return `${ansi}\x1b[2m${text}\x1b[22;39m`;
    return `${ansi}${text}\x1b[39m`;
  }

  bg(color: ThemeBg, text: string): string {
    const ansi = this.tokenAnsi(this.bgAnsi, color);
    return `${ansi}${text}\x1b[49m`;
  }

  private tokenAnsi<T extends ThemeToken>(ansi: Map<T, string>, token: T): string {
    const value = ansi.get(token);
    if (value === undefined) throw new Error(`Unknown theme color: ${token}`);
    return value;
  }

  bold(text: string): string {
    return chalk.bold(text);
  }

  italic(text: string): string {
    return chalk.italic(text);
  }

  underline(text: string): string {
    return chalk.underline(text);
  }

  inverse(text: string): string {
    return chalk.inverse(text);
  }

  strikethrough(text: string): string {
    return chalk.strikethrough(text);
  }

  getFgAnsi(color: ThemeColor): string {
    const ansi = this.tokenAnsi(this.fgAnsi, color);
    return this.dimTokens.has(color) ? `${ansi}\x1b[2m` : ansi;
  }

  getBgAnsi(color: ThemeBg): string {
    return this.tokenAnsi(this.bgAnsi, color);
  }

  getColorMode(): tuiTypes.TerminalColorMode {
    return this.mode;
  }

  getThinkingBorderColor(level: agentTypes.ThinkingLevel): (str: string) => string {
    switch (level) {
      case "off":
        return (str: string) => this.fg("thinkingOff", str);
      case "minimal":
        return (str: string) => this.fg("thinkingMinimal", str);
      case "low":
        return (str: string) => this.fg("thinkingLow", str);
      case "medium":
        return (str: string) => this.fg("thinkingMedium", str);
      case "high":
        return (str: string) => this.fg("thinkingHigh", str);
      case "xhigh":
        return (str: string) => this.fg("thinkingXhigh", str);
      case "max":
        return (str: string) => this.fg("thinkingMax", str);
      default:
        return (str: string) => this.fg("thinkingOff", str);
    }
  }

  getBashModeBorderColor(): (str: string) => string {
    return (str: string) => this.fg("bashMode", str);
  }
}

let BUILTIN_THEMES: Record<string, ThemeJson> | undefined;

function getBuiltinThemes(): Record<string, ThemeJson> {
  if (BUILTIN_THEMES === undefined) {
    const themesDir = getThemesDir();
    const darkPath = join(themesDir, "dark.json");
    const lightPath = join(themesDir, "light.json");
    BUILTIN_THEMES = {
      dark: JSON.parse(stripBom(fs.readFileSync(darkPath, "utf-8"))) as ThemeJson,
      light: JSON.parse(stripBom(fs.readFileSync(lightPath, "utf-8"))) as ThemeJson,
    };
  }
  return BUILTIN_THEMES;
}

export function getAvailableThemes(): string[] {
  return getAvailableThemesWithPaths().map(({ name }) => name);
}

export interface ThemeInfo {
  name: string;
  path: string | undefined;
}

export function getAvailableThemesWithPaths(): ThemeInfo[] {
  const themesDir = getThemesDir();
  const result: ThemeInfo[] = [];
  const seen = new Set<string>();
  const addTheme = (themeInfo: ThemeInfo) => {
    if (seen.has(themeInfo.name)) {
      return;
    }
    seen.add(themeInfo.name);
    result.push(themeInfo);
  };

  addTheme({ name: SYSTEM_THEME_NAME, path: undefined });
  for (const name of Object.keys(getBuiltinThemes())) {
    addTheme({ name, path: join(themesDir, `${name}.json`) });
  }

  for (const themeInfo of getCustomThemeInfos()) {
    addTheme(themeInfo);
  }

  for (const [name, theme] of registeredThemes.entries()) {
    addTheme({ name, path: theme.sourcePath });
  }

  return result.sort((a, b) =>
    a.name === SYSTEM_THEME_NAME
      ? -1
      : b.name === SYSTEM_THEME_NAME
        ? 1
        : a.name.localeCompare(b.name),
  );
}

function getCustomThemeInfos(): ThemeInfo[] {
  const customThemesDir = getCustomThemesDir();
  const result: ThemeInfo[] = [];
  if (!fs.existsSync(customThemesDir)) {
    return result;
  }

  for (const file of fs.readdirSync(customThemesDir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const themePath = join(customThemesDir, file);
    try {
      const customTheme = loadThemeFromPath(themePath);
      if (customTheme.name !== undefined && customTheme.name !== "") {
        result.push({ name: customTheme.name, path: themePath });
      }
    } catch {}
  }
  return result;
}

function assertThemeNameIsValid(name: string): void {
  if (name.includes("/")) {
    throw new Error(
      `Invalid theme name "${name}": theme names cannot contain "/" because it is reserved for automatic light/dark theme settings.`,
    );
  }
}

function parseThemeJson(label: string, json: unknown): ThemeJson {
  if (themeJsonValidator !== undefined) return themeJsonValidator(label, json);
  if (typeof json !== "object" || json === null || !("colors" in json)) {
    throw new Error(`Invalid theme "${label}": expected an object with a "colors" map.`);
  }
  return json as ThemeJson;
}

function parseThemeJsonContent(label: string, content: string): ThemeJson {
  let json: unknown;
  try {
    json = JSON.parse(stripBom(content));
  } catch (error) {
    throw new Error(`Failed to parse theme ${label}: ${error}`, { cause: error });
  }
  return parseThemeJson(label, json);
}

function loadThemeJson(name: string): ThemeJson {
  const builtinThemes = getBuiltinThemes();
  const builtinTheme = builtinThemes[name];
  if (builtinTheme !== undefined) {
    return builtinTheme;
  }
  const registeredTheme = registeredThemes.get(name);
  if (registeredTheme?.sourcePath !== undefined && registeredTheme?.sourcePath !== "") {
    const content = fs.readFileSync(registeredTheme.sourcePath, "utf-8");
    return parseThemeJsonContent(registeredTheme.sourcePath, content);
  }
  if (registeredTheme !== undefined) {
    throw new Error(`Theme "${name}" does not have a source path for export`);
  }
  const customThemesDir = getCustomThemesDir();
  const themePath = join(customThemesDir, `${name}.json`);
  if (!fs.existsSync(themePath)) {
    throw new Error(`Theme not found: ${name}`);
  }
  const content = fs.readFileSync(themePath, "utf-8");
  return parseThemeJsonContent(name, content);
}

function splitThemeColors(colors: ResolvedThemeColorValues<string | number>): {
  fgColors: Record<ThemeColor, string | number>;
  bgColors: Record<ThemeBg, string | number>;
} {
  const fgColors = {} as Record<ThemeColor, string | number>;
  const bgColors = {} as Record<ThemeBg, string | number>;
  for (const [key, value] of Object.entries(colors)) {
    if (THEME_TOKENS[key as ThemeToken].slot === "background") {
      bgColors[key as ThemeBg] = value;
    } else {
      fgColors[key as ThemeColor] = value;
    }
  }
  return { bgColors, fgColors };
}

function createTheme(
  themeJson: ThemeJson,
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
    sourcePath,
  });
}

function createSystemTheme(mode?: tuiTypes.TerminalColorMode): Theme {
  const generated = generateSystemThemeColors({
    ...terminalColors,
    appearanceHint: getTerminalTheme(),
    saturation: terminalColorsPending ? 0 : 1,
  });
  const { fgColors, bgColors } = splitThemeColors(withThemeTokenFallbacks(generated.colors));
  return new Theme(fgColors, bgColors, mode ?? getTerminalColorMode(), {
    appearance: generated.appearance,
    dim: generated.dim,
    name: SYSTEM_THEME_NAME,
  });
}

export const loadThemeFromPath: {
  (mode?: tuiTypes.TerminalColorMode): (themePath: string) => Theme;
  (themePath: string, mode?: tuiTypes.TerminalColorMode): Theme;
} = dual(
  (args) => typeof args[0] === "string" && args[0] !== "truecolor" && args[0] !== "256color",
  (themePath: string, mode?: tuiTypes.TerminalColorMode): Theme => {
    const content = fs.readFileSync(themePath, "utf-8");
    const themeJson = parseThemeJsonContent(themePath, content);
    return createTheme(themeJson, mode, themePath);
  },
);

function loadTheme(name: string, mode?: tuiTypes.TerminalColorMode): Theme {
  if (name === SYSTEM_THEME_NAME) return createSystemTheme(mode);
  const registeredTheme = registeredThemes.get(name);
  if (registeredTheme !== undefined) {
    return registeredTheme;
  }
  const themeJson = loadThemeJson(name);
  return createTheme(themeJson, mode);
}

export function getThemeByName(name: string): Theme | undefined {
  try {
    return loadTheme(name);
  } catch {
    return undefined;
  }
}

export type TerminalTheme = "dark" | "light";

export function parseAutoThemeSetting(
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

export const resolveThemeSetting: {
  (terminalTheme: TerminalTheme): (themeSetting: string | undefined) => string | undefined;
  (themeSetting: string | undefined, terminalTheme: TerminalTheme): string | undefined;
} = dual(
  2,
  (themeSetting: string | undefined, terminalTheme: TerminalTheme): string | undefined => {
    const autoTheme = parseAutoThemeSetting(themeSetting);
    if (autoTheme !== undefined) {
      return terminalTheme === "light" ? autoTheme.lightTheme : autoTheme.darkTheme;
    }
    if (themeSetting?.includes("/") === true) return undefined;
    if (typeof themeSetting === "string") return themeSetting;
    return undefined;
  },
);

export function detectColorFgBgTheme(
  env: NodeJS.ProcessEnv = envSnapshot(),
): TerminalTheme | undefined {
  const bg = env["COLORFGBG"]?.split(";").at(-1)?.trim();
  if (bg === undefined || bg === "" || !/^\d{1,2}$/u.test(bg)) return undefined;
  const index = Number(bg);
  if (index > 15) return undefined;
  return index <= 6 || index === 8 ? "dark" : "light";
}

export const detectTerminalTheme: {
  (
    reportedScheme?: TerminalTheme,
    env?: NodeJS.ProcessEnv,
  ): (colors?: tuiTypes.TerminalColors) => TerminalTheme;
  (
    colors?: tuiTypes.TerminalColors,
    reportedScheme?: TerminalTheme,
    env?: NodeJS.ProcessEnv,
  ): TerminalTheme;
} = dual(
  (args) =>
    (typeof args[0] === "object" && args[0] !== null) ||
    (args[0] === undefined && typeof args[1] !== "object"),
  (
    colors: tuiTypes.TerminalColors = {},
    reportedScheme?: TerminalTheme,
    env: NodeJS.ProcessEnv = envSnapshot(),
  ): TerminalTheme => {
    const { background, foreground } = colors;
    if (background !== undefined) return terminalAppearance(background, foreground);
    return reportedScheme ?? detectColorFgBgTheme(env) ?? "dark";
  },
);

export function getTerminalTheme(): TerminalTheme {
  return detectTerminalTheme(terminalColors, terminalColorScheme);
}

const THEME_KEY = Symbol.for("@msa/coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

export const theme: Theme = new Proxy({} as Theme, {
  get(_target, prop) {
    const t = (globalThis as Record<symbol, Theme>)[THEME_KEY];
    if (t === undefined) throw new Error("Theme not initialized. Call initTheme() first.");
    return (t as unknown as Record<string | symbol, unknown>)[prop];
  },
});

function setGlobalTheme(t: Theme): void {
  (globalThis as Record<symbol, Theme>)[THEME_KEY] = t;
  (globalThis as Record<symbol, Theme>)[THEME_KEY_OLD] = t;
}

let currentThemeName: string | undefined;
let themeWatcher: fs.FSWatcher | undefined;
let themeReloadTimer: Scheduled | undefined;
let onThemeChangeCallback: (() => void) | undefined;
const registeredThemes = new Map<string, Theme>();

export function setRegisteredThemes(themes: Theme[]): void {
  registeredThemes.clear();
  for (const entry of themes) {
    if (entry.name !== undefined && entry.name !== "") {
      assertThemeNameIsValid(entry.name);
      registeredThemes.set(entry.name, entry);
    }
  }
}

export const initTheme: {
  (enableWatcher?: boolean): (themeName?: string) => void;
  (themeName?: string, enableWatcher?: boolean): void;
} = dual(
  (args) => typeof args[0] !== "boolean",
  (themeName?: string, enableWatcher: boolean = false): void => {
    const name = themeName ?? SYSTEM_THEME_NAME;
    currentThemeName = name;
    try {
      setGlobalTheme(loadTheme(name));
      if (enableWatcher) {
        startThemeWatcher();
      }
    } catch {
      currentThemeName = SYSTEM_THEME_NAME;
      setGlobalTheme(loadTheme(SYSTEM_THEME_NAME));
    }
  },
);

export const setTheme: {
  (enableWatcher?: boolean): (name: string) => { success: boolean; error?: string };
  (name: string, enableWatcher?: boolean): { success: boolean; error?: string };
} = dual(
  (args) => typeof args[0] === "string",
  (name: string, enableWatcher: boolean = false): { success: boolean; error?: string } => {
    currentThemeName = name;
    try {
      setGlobalTheme(loadTheme(name));
      if (enableWatcher) {
        startThemeWatcher();
      }
      if (onThemeChangeCallback !== undefined) {
        onThemeChangeCallback();
      }
      return { success: true };
    } catch (error) {
      currentThemeName = SYSTEM_THEME_NAME;
      setGlobalTheme(loadTheme(SYSTEM_THEME_NAME));
      return {
        error: toErrorMessage(error),
        success: false,
      };
    }
  },
);

export function setThemeInstance(themeInstance: Theme): void {
  setGlobalTheme(themeInstance);
  currentThemeName = "<in-memory>";
  stopThemeWatcher();
  if (onThemeChangeCallback !== undefined) {
    onThemeChangeCallback();
  }
}

export function onThemeChange(callback: () => void): void {
  onThemeChangeCallback = callback;
}

function startThemeWatcher(): void {
  stopThemeWatcher();

  if (
    currentThemeName === undefined ||
    currentThemeName === "" ||
    currentThemeName === "dark" ||
    currentThemeName === "light" ||
    currentThemeName === SYSTEM_THEME_NAME
  ) {
    return;
  }

  const customThemesDir = getCustomThemesDir();
  const watchedThemeName = currentThemeName;
  const watchedFileName = `${watchedThemeName}.json`;
  const themeFile = join(customThemesDir, watchedFileName);

  if (!fs.existsSync(themeFile)) {
    return;
  }

  const scheduleReload = startThemeWatcherScheduleReload(watchedThemeName, themeFile);

  startThemeWatcherPart2(customThemesDir, watchedThemeName, scheduleReload, watchedFileName);
}

function startThemeWatcherScheduleReload(watchedThemeName: string, themeFile: string): () => void {
  const scheduleReload = () => {
    if (themeReloadTimer !== undefined) {
      themeReloadTimer.cancel();
    }
    themeReloadTimer = schedule(() => {
      themeReloadTimer = undefined;

      if (currentThemeName !== watchedThemeName) {
        return;
      }

      if (!fs.existsSync(themeFile)) {
        return;
      }

      try {
        const reloadedTheme = loadThemeFromPath(themeFile);
        registeredThemes.set(watchedThemeName, reloadedTheme);
        setGlobalTheme(reloadedTheme);
        if (onThemeChangeCallback !== undefined) {
          onThemeChangeCallback();
        }
      } catch {}
    }, 100);
  };
  return scheduleReload;
}

function startThemeWatcherPart2(
  customThemesDir: string,
  watchedThemeName: string,
  scheduleReload: () => void,
  watchedFileName: string,
): void {
  themeWatcher =
    watchWithErrorHandler(
      customThemesDir,
      (_eventType, filename) => {
        if (currentThemeName !== watchedThemeName) {
          return;
        }
        if (filename === null || filename === "") {
          scheduleReload();
          return;
        }
        if (filename !== watchedFileName) {
          return;
        }
        scheduleReload();
      },
      () => {
        closeWatcher(themeWatcher);
        themeWatcher = undefined;
      },
    ) ?? undefined;
}

export function stopThemeWatcher(): void {
  if (themeReloadTimer !== undefined) {
    themeReloadTimer.cancel();
    themeReloadTimer = undefined;
  }
  closeWatcher(themeWatcher);
  themeWatcher = undefined;
}

export function getResolvedThemeColors(themeName?: string): Record<string, string> {
  const colors = loadTheme(themeName ?? currentThemeName ?? SYSTEM_THEME_NAME).colors;
  return Object.fromEntries(
    Object.entries(colors).map(([token, color]) => [token, colorToHex(color)]),
  );
}

export function isLightTheme(themeName?: string): boolean {
  return loadTheme(themeName ?? currentThemeName ?? SYSTEM_THEME_NAME).appearance === "light";
}

export function getThemeExportColors(themeName?: string): {
  pageBg?: string | undefined;
  cardBg?: string | undefined;
  infoBg?: string | undefined;
} {
  const name = themeName ?? currentThemeName ?? SYSTEM_THEME_NAME;
  if (name === SYSTEM_THEME_NAME) return {};
  try {
    const themeJson = loadThemeJson(name);
    const exportSection = themeJson.export;
    if (exportSection === undefined) return {};

    const vars = themeJson.vars ?? {};
    const resolve = (value: ColorValue | undefined): string | undefined => {
      if (value === undefined) return undefined;
      const resolved = resolveVarRefs(value, vars);
      if (typeof resolved === "number") return colorToHex(indexedColor(resolved));
      if (resolved === "") return undefined;
      if (/^okhsl\(/iu.test(resolved)) return colorToHex(parseColor(resolved));
      return resolved;
    };

    return {
      cardBg: resolve(exportSection.cardBg),
      infoBg: resolve(exportSection.infoBg),
      pageBg: resolve(exportSection.pageBg),
    };
  } catch {
    return {};
  }
}

type CliHighlightTheme = Record<string, (s: string) => string>;

let cachedHighlightThemeFor: Theme | undefined;
let cachedCliHighlightTheme: CliHighlightTheme | undefined;

function buildCliHighlightTheme(t: Theme): CliHighlightTheme {
  return {
    addition: (s: string) => t.fg("toolDiffAdded", s),
    attr: (s: string) => t.fg("syntaxVariable", s),
    built_in: (s: string) => t.fg("syntaxType", s),
    class: (s: string) => t.fg("syntaxType", s),
    comment: (s: string) => t.fg("syntaxComment", s),
    deletion: (s: string) => t.fg("toolDiffRemoved", s),
    doctag: (s: string) => t.fg("syntaxComment", s),
    emphasis: (s: string) => t.italic(s),
    function: (s: string) => t.fg("syntaxFunction", s),
    keyword: (s: string) => t.fg("syntaxKeyword", s),
    link: (s: string) => t.underline(s),
    literal: (s: string) => t.fg("syntaxNumber", s),
    meta: (s: string) => t.fg("muted", s),
    name: (s: string) => t.fg("syntaxKeyword", s),
    number: (s: string) => t.fg("syntaxNumber", s),
    operator: (s: string) => t.fg("syntaxOperator", s),
    params: (s: string) => t.fg("syntaxVariable", s),
    punctuation: (s: string) => t.fg("syntaxPunctuation", s),
    regexp: (s: string) => t.fg("syntaxString", s),
    string: (s: string) => t.fg("syntaxString", s),
    strong: (s: string) => t.bold(s),
    subst: (s: string) => t.fg("text", s),
    tag: (s: string) => t.fg("syntaxPunctuation", s),
    title: (s: string) => t.fg("syntaxFunction", s),
    type: (s: string) => t.fg("syntaxType", s),
    variable: (s: string) => t.fg("syntaxVariable", s),
  };
}

function getCliHighlightTheme(t: Theme): CliHighlightTheme {
  if (cachedHighlightThemeFor !== t || cachedCliHighlightTheme === undefined) {
    cachedHighlightThemeFor = t;
    cachedCliHighlightTheme = buildCliHighlightTheme(t);
  }
  return cachedCliHighlightTheme;
}

export const highlightCode: {
  (lang: string | undefined): (code: string) => string[];
  (code: string, lang: string | undefined): string[];
} = dual(2, (code: string, lang: string | undefined): string[] => {
  const validLang = lang !== undefined && lang !== "" && supportsLanguage(lang) ? lang : undefined;
  if (validLang === undefined || validLang === "") {
    return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
  }
  const opts = {
    ignoreIllegals: true,
    language: validLang,
    theme: getCliHighlightTheme(theme),
  };
  try {
    return highlight(code, opts).split("\n");
  } catch {
    return code.split("\n");
  }
});

export function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === undefined || ext === "") return undefined;

  const extToLang: Record<string, string> = {
    bash: "bash",
    c: "c",
    cc: "cpp",
    cjs: "javascript",
    clj: "clojure",
    cmake: "cmake",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    cxx: "cpp",
    dockerfile: "dockerfile",
    erl: "erlang",
    ex: "elixir",
    exs: "elixir",
    fish: "fish",
    go: "go",
    graphql: "graphql",
    h: "c",
    hcl: "hcl",
    hpp: "cpp",
    hs: "haskell",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    kt: "kotlin",
    less: "less",
    lua: "lua",
    makefile: "makefile",
    markdown: "markdown",
    md: "markdown",
    mjs: "javascript",
    ml: "ocaml",
    perl: "perl",
    php: "php",
    proto: "protobuf",
    ps1: "powershell",
    py: "python",
    r: "r",
    rb: "ruby",
    rs: "rust",
    sass: "sass",
    scala: "scala",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    tf: "hcl",
    toml: "toml",
    ts: "typescript",
    tsx: "typescript",
    vim: "vim",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "bash",
  };

  return extToLang[ext];
}

export function getMarkdownTheme(): tuiTypes.MarkdownTheme {
  return {
    bold: (text: string) => theme.bold(text),
    code: (text: string) => theme.fg("mdCode", text),
    codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
    heading: (text: string) => theme.fg("mdHeading", text),
    highlightCode: (code: string, lang?: string): string[] => {
      const validLang =
        lang !== undefined && lang !== "" && supportsLanguage(lang) ? lang : undefined;
      if (validLang === undefined || validLang === "") {
        return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
      }
      const opts = {
        language: validLang,
        ignoreIllegals: true,
        theme: getCliHighlightTheme(theme),
      };
      try {
        return highlight(code, opts).split("\n");
      } catch {
        return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
      }
    },
    hr: (text: string) => theme.fg("mdHr", text),
    italic: (text: string) => theme.italic(text),
    link: (text: string) => theme.fg("mdLink", text),
    linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
    listBullet: (text: string) => theme.fg("mdListBullet", text),
    quote: (text: string) => theme.fg("mdQuote", text),
    quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
    strikethrough: (text: string) => theme.strikethrough(text),
    underline: (text: string) => theme.underline(text),
  };
}

export function getSelectListTheme(): tuiTypes.SelectListTheme {
  return {
    description: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
  };
}

export function getEditorTheme(): tuiTypes.EditorTheme {
  return {
    borderColor: (text: string) => theme.fg("borderMuted", text),
    selectList: getSelectListTheme(),
  };
}

export function getSettingsListTheme(): tuiTypes.SettingsListTheme {
  return {
    cursor: theme.fg("accent", "→ "),
    description: (text: string) => theme.fg("dim", text),
    hint: (text: string) => theme.fg("dim", text),
    label: (text: string, selected: boolean) => (selected ? theme.fg("accent", text) : text),
    value: (text: string, selected: boolean) =>
      selected ? theme.fg("accent", text) : theme.fg("muted", text),
  };
}
