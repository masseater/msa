import type agentTypes from "@msa/agent-core/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import chalk from "chalk";

import type sourceInfoTypes from "../../../core/source-info.types.ts";
import terminalColorsModule from "./terminal-colors.ts";
import themeColorTokens from "./theme-color-tokens.ts";
import type themeSchemaTypes from "./theme-schema.types.ts";
import type themeTokensTypes from "./theme-tokens.types.ts";
import type themeTypes from "./theme.types.ts";
const {
  backgroundAnsi,
  colorToOklch,
  foregroundAnsi,
  mixColors,
  parseColor,
  rgbColor,
  styleTextWithAnsi,
} = tui;

const { getTerminalColors, getTerminalTheme } = terminalColorsModule;
const { splitThemeColors, withThemeTokenFallbacks } = themeColorTokens;

const GUESSED_DEFAULT_COLORS: Record<
  themeTypes.ThemeAppearance,
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
): themeTypes.ThemeAppearance | undefined {
  const fg = averageLightness(foregrounds);
  const bg = averageLightness(backgrounds);
  if (fg !== undefined && bg !== undefined) return bg < fg ? "dark" : "light";
  if (bg !== undefined) return bg < 0.5 ? "dark" : "light";
  if (fg !== undefined) return fg > 0.5 ? "dark" : "light";
  return undefined;
}

export default class Theme {
  readonly name?: string | undefined;
  readonly sourcePath?: string | undefined;
  readonly sourceJson?: themeSchemaTypes.ValidatedThemeJson | undefined;
  sourceInfo?: sourceInfoTypes.SourceInfo | undefined;
  private mode: tuiTypes.TerminalColorMode;
  private readonly fgAnsi = new Map<themeTokensTypes.ThemeColor, string>();
  private readonly bgAnsi = new Map<themeTokensTypes.ThemeBg, string>();
  private readonly concreteColors: Partial<Record<themeTokensTypes.ThemeToken, tuiTypes.Color>> =
    {};
  private readonly defaultForegroundTokens: themeTokensTypes.ThemeToken[] = [];
  private readonly defaultBackgroundTokens: themeTokensTypes.ThemeToken[] = [];
  private readonly dimTokens: ReadonlySet<themeTokensTypes.ThemeColor>;
  private readonly ownAppearance: themeTypes.ThemeAppearance | undefined;
  private resolvedColors:
    | {
        terminal: tuiTypes.TerminalColors;
        colors: Readonly<Record<themeTokensTypes.ThemeToken, tuiTypes.Color>>;
      }
    | undefined;

  constructor(
    fgColors: Pick<themeTokensTypes.ThemeColorValues<string | number>, themeTokensTypes.ThemeColor>,
    bgColors: Pick<themeTokensTypes.ThemeColorValues<string | number>, themeTokensTypes.ThemeBg>,
    mode: tuiTypes.TerminalColorMode,
    options: {
      name?: string | undefined;
      sourcePath?: string | undefined;
      sourceJson?: themeSchemaTypes.ValidatedThemeJson | undefined;
      sourceInfo?: sourceInfoTypes.SourceInfo | undefined;
      appearance?: themeTypes.ThemeAppearance | undefined;
      dim?: readonly themeTokensTypes.ThemeColor[] | undefined;
    } = {},
  ) {
    this.name = options.name;
    this.sourcePath = options.sourcePath;
    this.sourceJson = options.sourceJson;
    this.sourceInfo = options.sourceInfo;
    this.mode = mode;
    this.dimTokens = new Set(options.dim);
    const { fgColors: foregrounds, bgColors: backgrounds } = splitThemeColors(
      withThemeTokenFallbacks({ ...fgColors, ...bgColors }),
    );
    const concreteForegrounds: tuiTypes.Color[] = [];
    const concreteBackgrounds: tuiTypes.Color[] = [];
    const addToken = (
      token: themeTokensTypes.ThemeToken,
      value: string | number,
      isBackground: boolean,
    ): string => {
      if (value === "") {
        (isBackground ? this.defaultBackgroundTokens : this.defaultForegroundTokens).push(token);
        return isBackground ? "\x1b[49m" : "\x1b[39m";
      }
      const color = parseColor(value);
      this.concreteColors[token] = color;
      (isBackground ? concreteBackgrounds : concreteForegrounds).push(color);
      return isBackground ? backgroundAnsi(color, mode) : foregroundAnsi(color, mode);
    };
    this.addForegrounds(foregrounds, addToken);
    for (const [token, value] of Object.entries(backgrounds) as [
      themeTokensTypes.ThemeBg,
      string | number,
    ][]) {
      this.bgAnsi.set(token, addToken(token, value, true));
    }
    this.ownAppearance =
      options.appearance ?? detectAppearance(concreteForegrounds, concreteBackgrounds);
  }

  private addForegrounds(
    foregrounds: Record<themeTokensTypes.ThemeColor, string | number>,
    addToken: (
      token: themeTokensTypes.ThemeToken,
      value: string | number,
      isBackground: boolean,
    ) => string,
  ) {
    for (const [token, value] of Object.entries(foregrounds) as [
      themeTokensTypes.ThemeColor,
      string | number,
    ][]) {
      this.fgAnsi.set(token, addToken(token, value, false));
    }
  }

  get appearance(): themeTypes.ThemeAppearance {
    return this.ownAppearance ?? getTerminalTheme();
  }

  get colors(): Readonly<Record<themeTokensTypes.ThemeToken, tuiTypes.Color>> {
    const terminal = getTerminalColors();
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
        colors: Object.freeze(colors as Record<themeTokensTypes.ThemeToken, tuiTypes.Color>),
        terminal,
      };
    }
    return this.resolvedColors.colors;
  }

  style(text: string, options: themeTypes.ThemeStyle): string {
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

  fg(color: themeTokensTypes.ThemeColor, text: string): string {
    const ansi = this.tokenAnsi(this.fgAnsi, color);
    if (this.dimTokens.has(color)) return `${ansi}\x1b[2m${text}\x1b[22;39m`;
    return `${ansi}${text}\x1b[39m`;
  }

  bg(color: themeTokensTypes.ThemeBg, text: string): string {
    const ansi = this.tokenAnsi(this.bgAnsi, color);
    return `${ansi}${text}\x1b[49m`;
  }

  private tokenAnsi<T extends themeTokensTypes.ThemeToken>(ansi: Map<T, string>, token: T): string {
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

  getFgAnsi(color: themeTokensTypes.ThemeColor): string {
    const ansi = this.tokenAnsi(this.fgAnsi, color);
    return this.dimTokens.has(color) ? `${ansi}\x1b[2m` : ansi;
  }

  getBgAnsi(color: themeTokensTypes.ThemeBg): string {
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
