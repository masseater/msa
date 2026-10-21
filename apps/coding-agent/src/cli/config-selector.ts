import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import ConfigSelectorComponent from "../modes/interactive/components/config-selector.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import interop from "../utils/interop.ts";
import type configSelectorTypes from "./config-selector.types.ts";

const { awaited, awaiting } = awaitingModule;
const { initTheme, refreshCustomThemes, stopThemeWatcher } = themeModule;
const { callbackPromise } = interop;
const { ProcessTerminal, TuiMainScreen } = tui;

function selectConfig(options: configSelectorTypes.ConfigSelectorOptions): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(refreshCustomThemes());
      initTheme(options.settingsManager.display.getTheme(), true);

      return yield* awaited(
        callbackPromise((resolve) => {
          const ui: tuiTypes.TUI = new TuiMainScreen(
            new ProcessTerminal(),
            options.settingsManager.terminal.getShowHardwareCursor(),
            options.agentDir,
          );
          ui.setClearOnShrink(options.settingsManager.terminal.getClearOnShrink());
          let resolved = false;

          const selector = new ConfigSelectorComponent(
            options.resolvedPaths,
            options.settingsManager,
            options.cwd,
            options.agentDir,
            () => {
              if (!resolved) {
                resolved = true;
                ui.stop();
                stopThemeWatcher();
                resolve();
              }
            },
            () => {
              ui.stop();
              stopThemeWatcher();
              void options.settingsManager.persistence.flush().then(() => process.exit(0));
            },
            () => ui.requestRender(),
            ui.terminal.rows,
            options.writeScope,
            options.projectModeAvailable,
          );

          ui.addChild(selector);
          ui.setFocus(selector.getResourceList());
          ui.start();
        }),
      );
    }),
  );
}

const configSelector = {
  selectConfig,
};

export default configSelector;
