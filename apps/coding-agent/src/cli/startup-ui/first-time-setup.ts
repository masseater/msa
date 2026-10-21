import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import FirstTimeSetupComponent from "../../modes/interactive/components/first-time-setup.ts";
import type firstTimeSetupTypes from "../../modes/interactive/components/first-time-setup.types.ts";
import systemTheme from "../../modes/interactive/theme/system-theme.ts";
import themeModule from "../../modes/interactive/theme/theme.ts";
import interop from "../../utils/interop.ts";
import startupTui from "./startup-tui.ts";
import terminalTheme from "./terminal-theme.ts";

const { setTheme } = themeModule;
const { clearStartupTui, createStartupTui } = startupTui;
const { queryStartupTerminalColors } = terminalTheme;
const { SYSTEM_THEME_NAME } = systemTheme;
const { callbackPromise } = interop;
const { awaited, awaiting } = awaitingModule;

function showFirstTimeSetup(settingsManager: settingsManagerTypes.SettingsManager): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          let settled = false;
          const finish = (result: firstTimeSetupTypes.FirstTimeSetupResult | undefined) =>
            Effect.runPromise(
              awaiting(function* () {
                if (settled) {
                  return;
                }
                settled = true;
                if (result !== undefined) {
                  settingsManager.display.setTheme(result.theme);
                  settingsManager.telemetry.setEnableAnalytics(result.shareAnalytics);
                  yield* awaited(settingsManager.persistence.flush());
                }
                yield* awaited(clearStartupTui(ui));
                ui.stop();
                resolve();
              }),
            );

          ui.start();
          let previewTheme = SYSTEM_THEME_NAME;
          setTheme(previewTheme);
          const component = new FirstTimeSetupComponent({
            onCancel: () => void finish(undefined),
            onSubmit: (result) => void finish(result),
            onThemePreview: (themeName) => {
              previewTheme = themeName;
              setTheme(themeName);
              ui.requestRender();
            },
          });
          ui.addChild(component);
          ui.setFocus(component);
          ui.requestRender();

          queryStartupTerminalColors(ui, () => setTheme(previewTheme));
        }),
      );
    }),
  );
}

const firstTimeSetup = { showFirstTimeSetup };

export default firstTimeSetup;
