import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import ExtensionSelectorComponent from "../modes/interactive/components/extension-selector.ts";
import interop from "../utils/interop.ts";
import startupUiPart3 from "./startup-ui-part3.ts";
import startupUiPart4 from "./startup-ui-part4.ts";

const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { createStartupTui } = startupUiPart3;
const { clearStartupTui, startStartupTui } = startupUiPart4;

function showStartupSelectorImpl<T>(
  settingsManager: settingsManagerTypes.SettingsManager,
  title: string,
  options: Array<{ label: string; value: T }>,
): Promise<T | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          let settled = false;
          const finish = (result: T | undefined) =>
            Effect.runPromise(
              awaiting(function* () {
                if (settled) {
                  return;
                }
                settled = true;
                yield* awaited(clearStartupTui(ui));
                ui.stop();
                resolve(result);
              }),
            );

          const selector = new ExtensionSelectorComponent(
            title,
            options.map((option) => option.label),
            (option) => void finish(options.find((entry) => entry.label === option)?.value),
            () => void finish(undefined),
            { tui: ui },
          );
          ui.addChild(selector);
          ui.setFocus(selector);
          startStartupTui(ui, settingsManager);
        }),
      );
    }),
  );
}

const showStartupSelector: {
  <T>(
    settingsManager: settingsManagerTypes.SettingsManager,
    title: string,
    options: Array<{ label: string; value: T }>,
  ): Promise<T | undefined>;
  <T>(
    title: string,
    options: Array<{ label: string; value: T }>,
  ): (settingsManager: settingsManagerTypes.SettingsManager) => Promise<T | undefined>;
} = dual((args: IArguments) => args.length >= 3, showStartupSelectorImpl);

const startupUiPart6 = {
  showStartupSelector,
};

export default startupUiPart6;
