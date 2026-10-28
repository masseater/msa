import config from "../../../config.ts";
import platformModule from "../../../core/platform/index.ts";
import systemTheme from "./system-theme.ts";
import themeJson from "./theme-json.ts";
import themeState from "./theme-state.ts";
import type themeTypes from "./theme.types.ts";

const { getThemesDir } = config;
const { join } = platformModule;
const { SYSTEM_THEME_NAME } = systemTheme;
const { registeredThemes } = themeState;

function getCustomThemeInfos(): themeTypes.ThemeInfo[] {
  return [...themeJson.getCustomThemeFiles().values()]
    .filter(({ json }) => json.name !== undefined && json.name !== "")
    .map(({ json, path }) => ({ name: json.name!, path }));
}

function compareThemeInfos(a: themeTypes.ThemeInfo, b: themeTypes.ThemeInfo): number {
  if (a.name === SYSTEM_THEME_NAME) return -1;
  if (b.name === SYSTEM_THEME_NAME) return 1;
  return a.name.localeCompare(b.name);
}

function getAvailableThemesWithPaths(): themeTypes.ThemeInfo[] {
  const themesDir = getThemesDir();
  const byName = new Map<string, themeTypes.ThemeInfo>();
  const addTheme = (themeInfo: themeTypes.ThemeInfo) => {
    if (!byName.has(themeInfo.name)) byName.set(themeInfo.name, themeInfo);
  };
  addTheme({ name: SYSTEM_THEME_NAME, path: undefined });
  for (const name of Object.keys(themeJson.getBuiltinThemes())) {
    addTheme({ name, path: join(themesDir, `${name}.json`) });
  }
  for (const themeInfo of getCustomThemeInfos()) {
    addTheme(themeInfo);
  }
  for (const [name, theme] of registeredThemes.entries()) {
    addTheme({ name, path: theme.sourcePath });
  }
  return [...byName.values()].sort(compareThemeInfos);
}

function getAvailableThemes(): string[] {
  return getAvailableThemesWithPaths().map(({ name }) => name);
}

function assertThemeNameIsValid(name: string): void {
  if (name.includes("/")) {
    throw new Error(
      `Invalid theme name "${name}": theme names cannot contain "/" because it is reserved for automatic light/dark theme settings.`,
    );
  }
}

function setRegisteredThemes(themes: themeTypes.Theme[]): void {
  registeredThemes.clear();
  for (const entry of themes) {
    if (entry.name !== undefined && entry.name !== "") {
      assertThemeNameIsValid(entry.name);
      registeredThemes.set(entry.name, entry);
    }
  }
}

const themeCatalog = {
  getAvailableThemes,
  getAvailableThemesWithPaths,
  refreshCustomThemes: themeJson.refreshCustomThemes,
  setRegisteredThemes,
};

export default themeCatalog;
