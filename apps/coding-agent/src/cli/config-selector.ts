import { ProcessTerminal, type TUI, TuiMainScreen } from "@msa/tui";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import {
  ConfigSelectorComponent,
  type ScopedResolvedPaths,
} from "../modes/interactive/components/config-selector.ts";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.ts";
import { callbackPromise } from "../utils/interop.ts";

export interface ConfigSelectorOptions {
  resolvedPaths: ScopedResolvedPaths;
  settingsManager: SettingsManager;
  cwd: string;
  agentDir: string;
  writeScope: "global" | "project";
  projectModeAvailable: boolean;
}

export function selectConfig(options: ConfigSelectorOptions): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      initTheme(options.settingsManager.getTheme(), true);

      return yield* awaited(
        callbackPromise((resolve) => {
          const ui: TUI = new TuiMainScreen(
            new ProcessTerminal(),
            options.settingsManager.getShowHardwareCursor(),
            options.agentDir,
          );
          ui.setClearOnShrink(options.settingsManager.getClearOnShrink());
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
              process.exit(0);
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
