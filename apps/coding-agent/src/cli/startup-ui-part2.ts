import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import DefaultPackageManager from "../core/default-package-manager.ts";
import SettingsManager from "../core/settings-manager.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import type themeTypes from "../modes/interactive/theme/theme.types.ts";
import startupUiPart1 from "./startup-ui-part1.ts";

const { awaited, awaiting } = awaitingModule;
const { getAgentDir } = config;
const { loadThemes } = startupUiPart1;

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
        packageManager.resolve(() => Effect.runPromise(Effect.succeed("skip"))),
      );
      return loadThemes(resolvedPaths.themes);
    }),
  );
}

const startupUiPart2 = {
  loadStartupThemes,
};

export default startupUiPart2;
