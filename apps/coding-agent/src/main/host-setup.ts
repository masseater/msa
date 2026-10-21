import { Effect } from "effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import httpDispatcher from "../core/http-dispatcher.ts";
import SettingsManager from "../core/settings-manager.ts";
import windowsSelfUpdate from "../utils/windows-self-update.ts";

const { awaited, awaiting } = awaitingModule;
const { getPackageDir } = config;
const { configureHttpDispatcher, applyHttpProxySettings } = httpDispatcher;
const { cleanupWindowsSelfUpdateQuarantine } = windowsSelfUpdate;

function prepareHost(cwd: string, agentDir: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      if (process.platform === "win32") {
        yield* awaited(cleanupWindowsSelfUpdateQuarantine(getPackageDir()));
      }
      const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, {
        projectTrusted: false,
      });
      applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
      configureHttpDispatcher();
    }),
  );
}

const hostSetup = { prepareHost };

export default hostSetup;
