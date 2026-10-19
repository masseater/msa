import { setKeybindings } from "@msa/tui";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { KeybindingsManager } from "../core/keybindings.ts";
import type { SessionInfo, SessionListProgress } from "../core/session-manager.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { SessionSelectorComponent } from "../modes/interactive/components/session-selector.ts";
import { callbackPromise } from "../utils/interop.ts";
import { createStartupTui, startStartupTui } from "./startup-ui.ts";

type SessionsLoader = (
  onProgress?: SessionListProgress,
  signal?: AbortSignal,
) => Promise<SessionInfo[]>;

function selectSessionImpl(
  currentSessionsLoader: SessionsLoader,
  allSessionsLoader: SessionsLoader,
  settingsManager: SettingsManager,
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
            { showRenameHint: false, keybindings },
          );

          ui.addChild(selector);
          ui.setFocus(selector.getSessionList());
          startStartupTui(ui, settingsManager);
        }),
      );
    }),
  );
}

export const selectSession: {
  (
    currentSessionsLoader: SessionsLoader,
    allSessionsLoader: SessionsLoader,
    settingsManager: SettingsManager,
  ): Promise<string | null>;
  (
    allSessionsLoader: SessionsLoader,
    settingsManager: SettingsManager,
  ): (currentSessionsLoader: SessionsLoader) => Promise<string | null>;
} = dual((args: IArguments) => args.length >= 3, selectSessionImpl);
