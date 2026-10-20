import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import ExtensionInputComponent from "../modes/interactive/components/extension-input.ts";
import interop from "../utils/interop.ts";
import startupUiPart3 from "./startup-ui-part3.ts";
import startupUiPart4 from "./startup-ui-part4.ts";

const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { createStartupTui } = startupUiPart3;
const { clearStartupTui, startStartupTui } = startupUiPart4;

function showStartupInputImpl(
  settingsManager: settingsManagerTypes.SettingsManager,
  title: string,
  placeholder?: string,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          let settled = false;
          const finish = (result: string | undefined) =>
            Effect.runPromise(
              awaiting(function* () {
                if (settled) {
                  return;
                }
                settled = true;
                input.dispose();
                yield* awaited(clearStartupTui(ui));
                ui.stop();
                resolve(result);
              }),
            );

          const input = new ExtensionInputComponent(
            title,
            placeholder,
            (value) => void finish(value),
            () => void finish(undefined),
            {
              tui: ui,
            },
          );
          ui.addChild(input);
          ui.setFocus(input);
          startStartupTui(ui, settingsManager);
        }),
      );
    }),
  );
}

const showStartupInput: {
  (
    settingsManager: settingsManagerTypes.SettingsManager,
    title: string,
    placeholder?: string,
  ): Promise<string | undefined>;
  (
    title: string,
    placeholder?: string,
  ): (settingsManager: settingsManagerTypes.SettingsManager) => Promise<string | undefined>;
} = dual((args: IArguments) => args.length >= 2, showStartupInputImpl);

const startupUiPart8 = {
  showStartupInput,
};

export default startupUiPart8;
