import componentThemes from "./component-themes.ts";
import systemTheme from "./system-theme.ts";
import themeCatalog from "./theme-catalog.ts";
import themeExportColors from "./theme-export-colors.ts";
import themeHighlight from "./theme-highlight.ts";
import themeJson from "./theme-json.ts";
import themeLoader from "./theme-loader.ts";
import themeSelection from "./theme-selection.ts";
import themeState from "./theme-state.ts";
import themeWatcher from "./theme-watcher.ts";

const themeModule = {
  ...componentThemes,
  ...themeCatalog,
  ...themeExportColors,
  ...themeSelection,
  SYSTEM_THEME_NAME: systemTheme.SYSTEM_THEME_NAME,
  getLanguageFromPath: themeHighlight.getLanguageFromPath,
  getThemeByName: themeLoader.getThemeByName,
  highlightCode: themeHighlight.highlightCode,
  loadThemeFromPath: themeLoader.loadThemeFromPath,
  setThemeJsonValidator: themeJson.setThemeJsonValidator,
  stopThemeWatcher: themeWatcher.stopThemeWatcher,
  theme: themeState.theme,
};

export default themeModule;
