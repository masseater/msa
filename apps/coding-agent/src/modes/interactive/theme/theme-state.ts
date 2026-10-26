import type themeTypes from "./theme.types.ts";

type Theme = themeTypes.Theme;

const THEME_KEY = Symbol.for("@msa/coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

const current = (): Theme => {
  const t = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
  if (t === undefined) throw new Error("Theme not initialized. Call initTheme() first.");
  return t;
};

const theme: themeTypes.Theme = {
  get appearance() {
    return current().appearance;
  },
  bg: (color, text) => current().bg(color, text),
  bold: (text) => current().bold(text),
  get colors() {
    return current().colors;
  },
  fg: (color, text) => current().fg(color, text),
  getBashModeBorderColor: () => current().getBashModeBorderColor(),
  getBgAnsi: (color) => current().getBgAnsi(color),
  getColorMode: () => current().getColorMode(),
  getFgAnsi: (color) => current().getFgAnsi(color),
  getThinkingBorderColor: (level) => current().getThinkingBorderColor(level),
  inverse: (text) => current().inverse(text),
  italic: (text) => current().italic(text),
  get name() {
    return current().name;
  },
  get sourceJson() {
    return current().sourceJson;
  },
  get sourcePath() {
    return current().sourcePath;
  },
  strikethrough: (text) => current().strikethrough(text),
  style: (text, options) => current().style(text, options),
  underline: (text) => current().underline(text),
};

function setGlobalTheme(t: Theme): void {
  (globalThis as Record<symbol, Theme>)[THEME_KEY] = t;
  (globalThis as Record<symbol, Theme>)[THEME_KEY_OLD] = t;
}

const selection: { currentName: string | undefined; onChange: (() => void) | undefined } = {
  currentName: undefined,
  onChange: undefined,
};

function notifyThemeChange(): void {
  if (selection.onChange !== undefined) {
    selection.onChange();
  }
}

const registeredThemes = new Map<string, Theme>();

const themeState = {
  notifyThemeChange,
  registeredThemes,
  selection,
  setGlobalTheme,
  theme,
};

export default themeState;
