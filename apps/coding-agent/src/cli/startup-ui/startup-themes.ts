import * as Effect from "effect/Effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import DefaultPackageManager from "../../core/default-package-manager.ts";
import type packageManagerTypes from "../../core/package-manager.types.ts";
import SettingsManager from "../../core/settings-manager.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import themeModule from "../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../modes/interactive/theme/theme.types.ts";

const { awaited, awaiting } = awaitingModule;
const { getAgentDir } = config;
const { loadThemeFromPath } = themeModule;

function loadThemes(
  resources: packageManagerTypes.ResolvedResource[],
): Promise<themeTypes.Theme[]> {
  return Promise.all(
    resources
      .filter((resource) => resource.enabled)
      .map((resource) => loadThemeFromPath(resource.path).catch(() => undefined)),
  ).then((loaded) => {
    const themes: themeTypes.Theme[] = [];
    const seen = new Set<string>();
    for (const loadedTheme of loaded) {
      if (loadedTheme === undefined) continue;
      if (loadedTheme.name !== undefined && loadedTheme.name !== "") {
        if (seen.has(loadedTheme.name)) continue;
        seen.add(loadedTheme.name);
      }
      themes.push(loadedTheme);
    }
    return themes;
  });
}

function loadStartupThemes(
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<themeTypes.Theme[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const globalSettingsManager = SettingsManager.inMemory(settingsManager.getGlobalSettings(), {
        projectTrusted: false,
      });
      const packageManager = new DefaultPackageManager({
        agentDir: getAgentDir(),
        cwd: process.cwd(),
        settingsManager: globalSettingsManager,
      });
      const resolvedPaths = yield* awaited(
        packageManager.resolution.resolve(() => Effect.runPromise(Effect.succeed("skip"))),
      );
      return yield* awaited(loadThemes(resolvedPaths.themes));
    }),
  );
}

const startupThemes = { loadStartupThemes };

export default startupThemes;
