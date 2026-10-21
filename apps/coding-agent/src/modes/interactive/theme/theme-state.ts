import type Theme from "./theme-class.ts";

const THEME_KEY = Symbol.for("@msa/coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

const theme: Theme = new Proxy({} as Theme, {
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
