import config from "../../../config.ts";
import platform from "../../../core/platform.ts";
import type platformTypes from "../../../core/platform.types.ts";
import nodeFs from "../../../core/platform/node/fs.ts";
import type nodeFsTypes from "../../../core/platform/node/fs.types.ts";
import fsWatch from "../../../utils/fs-watch.ts";
import pathModule from "../../path.ts";
import systemTheme from "./system-theme.ts";
import themeLoader from "./theme-loader.ts";
import themeState from "./theme-state.ts";

const { getCustomThemesDir } = config;
const { join } = pathModule;
const { closeWatcher, watchWithErrorHandler } = fsWatch;
const { selection } = themeState;

let themeWatcher: nodeFsTypes.FSWatcher | undefined;
let themeReloadTimer: platformTypes.Scheduled | undefined;

function reloadWatchedTheme(watchedThemeName: string, themeFile: string): void {
  if (selection.currentName !== watchedThemeName || !nodeFs.existsSync(themeFile)) {
    return;
  }
  try {
    const reloadedTheme = themeLoader.loadThemeFromPath(themeFile);
    themeState.registeredThemes.set(watchedThemeName, reloadedTheme);
    themeState.setGlobalTheme(reloadedTheme);
    themeState.notifyThemeChange();
  } catch {}
}

function scheduleReload(watchedThemeName: string, themeFile: string): void {
  themeReloadTimer?.cancel();
  themeReloadTimer = platform.schedule(() => {
    themeReloadTimer = undefined;
    reloadWatchedTheme(watchedThemeName, themeFile);
  }, 100);
}

function stopThemeWatcher(): void {
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

function startThemeWatcher(): void {
  stopThemeWatcher();
  const watchedThemeName = selection.currentName;
  if (watchedThemeName === undefined || isBundledThemeName(watchedThemeName)) {
    return;
  }
  const customThemesDir = getCustomThemesDir();
  const watchedFileName = `${watchedThemeName}.json`;
  const themeFile = join(customThemesDir, watchedFileName);
  if (!nodeFs.existsSync(themeFile)) {
    return;
  }
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

const themeWatcherModule = {
  startThemeWatcher,
  stopThemeWatcher,
};

export default themeWatcherModule;
