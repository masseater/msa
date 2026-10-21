import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import ExtensionInputComponent from "../../modes/interactive/components/extension-input.ts";
import ExtensionSelectorComponent from "../../modes/interactive/components/extension-selector.ts";
import interop from "../../utils/interop.ts";
import startupTui from "./startup-tui.ts";
import terminalTheme from "./terminal-theme.ts";

const { callbackPromise } = interop;
const { awaited, awaiting } = awaitingModule;
const { clearStartupTui, createStartupTui } = startupTui;
const { startStartupTui } = terminalTheme;

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

const startupPrompts = { showStartupInput, showStartupSelector };

export default startupPrompts;
