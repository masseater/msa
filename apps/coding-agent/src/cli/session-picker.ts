import tui from "@msa/tui";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import KeybindingsManager from "../core/keybindings-manager.ts";
import type sessionManagerTypes from "../core/session-manager.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import SessionSelectorComponent from "../modes/interactive/components/session-selector.ts";
import interop from "../utils/interop.ts";
import startupUi from "./startup-ui.ts";

const { awaited, awaiting } = awaitingModule;
const { createStartupTui, startStartupTui } = startupUi;
const { callbackPromise } = interop;
const { setKeybindings } = tui;

type SessionsLoader = (
  onProgress?: sessionManagerTypes.SessionListProgress,
  signal?: AbortSignal,
) => Promise<sessionManagerTypes.SessionInfo[]>;

function selectSessionImpl(
  currentSessionsLoader: SessionsLoader,
  allSessionsLoader: SessionsLoader,
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<string | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const ui = yield* awaited(createStartupTui(settingsManager));
      return yield* awaited(
        callbackPromise((resolve) => {
          const keybindings = KeybindingsManager.create();
          setKeybindings(keybindings);
          let resolved = false;

          const selector = new SessionSelectorComponent(
            currentSessionsLoader,
            allSessionsLoader,
            (path: string) => {
              if (!resolved) {
                resolved = true;
                ui.stop();
                resolve(path);
              }
            },
            () => {
              if (!resolved) {
                resolved = true;
                ui.stop();
                resolve(null);
              }
            },
            () => {
              ui.stop();
              process.exit(0);
            },
            () => ui.requestRender(),
            { keybindings, showRenameHint: false },
          );

          ui.addChild(selector);
          ui.setFocus(selector.getSessionList());
          startStartupTui(ui, settingsManager);
        }),
      );
    }),
  );
}

const selectSession: {
  (
    currentSessionsLoader: SessionsLoader,
    allSessionsLoader: SessionsLoader,
    settingsManager: settingsManagerTypes.SettingsManager,
  ): Promise<string | null>;
  (
    allSessionsLoader: SessionsLoader,
    settingsManager: settingsManagerTypes.SettingsManager,
  ): (currentSessionsLoader: SessionsLoader) => Promise<string | null>;
} = dual((args: IArguments) => args.length >= 3, selectSessionImpl);

const sessionPicker = {
  selectSession,
};

export default sessionPicker;
