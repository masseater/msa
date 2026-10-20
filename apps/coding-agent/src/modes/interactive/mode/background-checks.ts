import { Effect } from "effect";

import config from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import DefaultPackageManager from "../../../core/default-package-manager.ts";
import platformModule from "../../../core/platform.ts";
import processEnv from "../../../core/process-env.ts";
import versionCheck from "../../../utils/version-check.ts";
import type InteractiveMode from "../interactive-mode.ts";
import modelCatalogRefresh from "../model-catalog-refresh.ts";

const { awaited, awaitingWith } = awaitingModule;
const { schedule } = platformModule;
const { refreshModelCatalogs } = modelCatalogRefresh;
const { readEnv } = processEnv;
const { checkForNewMsaVersion } = versionCheck;

const { getAgentDir, VERSION } = config;

export default class BackgroundChecks {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  start(): void {
    if (readEnv("MSA_OFFLINE") === undefined || readEnv("MSA_OFFLINE") === "") {
      this.refreshCatalogs();
    }
    this.checkForNewVersion();
    this.checkForUpdates();
  }

  private refreshCatalogs(): void {
    const controller = new AbortController();
    const timeout = schedule(() => controller.abort(), 15_000);
    Effect.runFork(
      awaitingWith(function* () {
        try {
          yield* awaited(
            refreshModelCatalogs(
              this.mode.session.models.selection.modelRuntime,
              controller.signal,
            ),
          );
          this.mode.models.selector.updateAvailableProviderCount();
        } catch {
        } finally {
          timeout.cancel();
        }
      }, this),
    );
  }

  private checkForNewVersion(): void {
    Effect.runFork(
      awaitingWith(function* () {
        const newRelease = yield* awaited(checkForNewMsaVersion(VERSION));
        if (newRelease !== undefined) {
          this.mode.display.notices.startup.showNewVersionNotification(newRelease);
        }
      }, this),
    );
  }

  private checkForUpdates(): void {
    Effect.runFork(
      awaitingWith(function* () {
        try {
          const updates = yield* awaited(this.checkForPackageUpdates());
          if (updates.length > 0) {
            this.mode.display.notices.startup.showPackageUpdateNotification(updates);
          }
        } finally {
          if (process.platform === "win32" && this.mode.lifecycle.startup.isInitialized) {
            this.mode.lifecycle.events.updateTerminalTitle();
          }
        }
      }, this),
    );
  }

  checkForPackageUpdates(): Promise<string[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (readEnv("MSA_OFFLINE") !== undefined && readEnv("MSA_OFFLINE") !== "") {
          return [];
        }

        try {
          const packageManager = new DefaultPackageManager({
            agentDir: getAgentDir(),
            cwd: this.mode.sessionManager.getCwd(),
            settingsManager: this.mode.settingsManager,
          });
          const updates = yield* awaited(packageManager.checkForAvailableUpdates());
          return updates.map((update) => update.displayName);
        } catch {
          return [];
        }
      }, this),
    );
  }
}
