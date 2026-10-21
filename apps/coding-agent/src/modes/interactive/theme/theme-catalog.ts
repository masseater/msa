import config from "../../../config.ts";
import platformModule from "../../../core/platform/index.ts";
import nodeFs from "../../../core/platform/node/fs.ts";
import systemTheme from "./system-theme.ts";
import type Theme from "./theme-class.ts";
import themeJson from "./theme-json.ts";
import themeLoader from "./theme-loader.ts";
import themeState from "./theme-state.ts";
import type themeTypes from "./theme.types.ts";

const { getCustomThemesDir, getThemesDir } = config;
const { join } = platformModule;
const { SYSTEM_THEME_NAME } = systemTheme;
const { registeredThemes } = themeState;

function getCustomThemeInfos(): themeTypes.ThemeInfo[] {
  const customThemesDir = getCustomThemesDir();
  const result: themeTypes.ThemeInfo[] = [];
  if (!nodeFs.existsSync(customThemesDir)) {
    return result;
  }
  for (const file of nodeFs.readdirSync(customThemesDir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const themePath = join(customThemesDir, file);
    try {
      const customTheme = themeLoader.loadThemeFromPath(themePath);
      if (customTheme.name !== undefined && customTheme.name !== "") {
        result.push({ name: customTheme.name, path: themePath });
      }
    } catch {}
  }
  return result;
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

function setRegisteredThemes(themes: Theme[]): void {
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
  setRegisteredThemes,
};

export default themeCatalog;
