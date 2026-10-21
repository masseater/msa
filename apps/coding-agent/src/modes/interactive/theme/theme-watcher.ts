import config from "../../../config.ts";
import platform from "../../../core/platform/index.ts";
import type platformTypes from "../../../core/platform/index.types.ts";
import type nodeFsTypes from "../../../core/platform/node/fs.types.ts";
import fsWatch from "../../../utils/fs-watch.ts";
import systemTheme from "./system-theme.ts";
import themeJson from "./theme-json.ts";
import themeLoader from "./theme-loader.ts";
import themeState from "./theme-state.ts";

const { getCustomThemesDir } = config;
const { join } = platform;
const { exists } = platform.files;
const { closeWatcher, watchWithErrorHandler } = fsWatch;
const { selection } = themeState;

let themeWatcher: nodeFsTypes.FSWatcher | undefined;
let themeReloadTimer: platformTypes.Scheduled | undefined;
let watchGeneration = 0;

function applyReloadedTheme(watchedThemeName: string, themeFile: string): Promise<void> {
  return themeLoader.loadThemeFromPath(themeFile).then((reloadedTheme) => {
    if (selection.currentName !== watchedThemeName || reloadedTheme.sourceJson === undefined)
      return undefined;
    themeJson.setCustomThemeFile(watchedThemeName, {
      json: reloadedTheme.sourceJson,
      path: themeFile,
    });
    themeState.registeredThemes.set(watchedThemeName, reloadedTheme);
    themeState.setGlobalTheme(reloadedTheme);
    themeState.notifyThemeChange();
    return undefined;
  });
}

function reloadWatchedTheme(watchedThemeName: string, themeFile: string): Promise<void> {
  if (selection.currentName !== watchedThemeName) return Promise.resolve();
  return exists(themeFile)
    .then((found) => (found ? applyReloadedTheme(watchedThemeName, themeFile) : undefined))
    .catch(() => undefined);
}

function scheduleReload(watchedThemeName: string, themeFile: string): void {
  themeReloadTimer?.cancel();
  themeReloadTimer = platform.schedule(() => {
    themeReloadTimer = undefined;
    void reloadWatchedTheme(watchedThemeName, themeFile);
  }, 100);
}

function stopThemeWatcher(): void {
  watchGeneration++;
  themeReloadTimer?.cancel();
  themeReloadTimer = undefined;
  closeWatcher(themeWatcher);
  themeWatcher = undefined;
}

function isBundledThemeName(name: string | undefined): boolean {
  return (
    name === undefined ||
    name === "" ||
    name === "dark" ||
    name === "light" ||
    name === systemTheme.SYSTEM_THEME_NAME
  );
}

function watchThemeFile(watchedThemeName: string, customThemesDir: string): void {
  const watchedFileName = `${watchedThemeName}.json`;
  const themeFile = join(customThemesDir, watchedFileName);
  themeWatcher =
    watchWithErrorHandler(
      customThemesDir,
      (_eventType, filename) => {
        if (selection.currentName !== watchedThemeName) return;
        if (filename === null || filename === "" || filename === watchedFileName) {
          scheduleReload(watchedThemeName, themeFile);
        }
      },
      () => {
        closeWatcher(themeWatcher);
        themeWatcher = undefined;
      },
    ) ?? undefined;
}

function startThemeWatcher(): void {
  stopThemeWatcher();
  const watchedThemeName = selection.currentName;
  if (watchedThemeName === undefined || isBundledThemeName(watchedThemeName)) {
    return;
  }
  const generation = watchGeneration;
  const customThemesDir = getCustomThemesDir();
  void exists(join(customThemesDir, `${watchedThemeName}.json`)).then((found) => {
    if (found && generation === watchGeneration) watchThemeFile(watchedThemeName, customThemesDir);
    return undefined;
  });
}

const themeWatcherModule = {
  startThemeWatcher,
  stopThemeWatcher,
};

export default themeWatcherModule;
