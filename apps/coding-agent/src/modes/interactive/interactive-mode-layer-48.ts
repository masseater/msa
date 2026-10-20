import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import platformModule from "../../core/platform.ts";
import processEnv from "../../core/process-env.ts";
import versionCheck from "../../utils/version-check.ts";
import InteractiveModeLayer47 from "./interactive-mode-layer-47.ts";
import modelCatalogRefresh from "./model-catalog-refresh.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { readEnv } = processEnv;
const { schedule } = platformModule;
const { refreshModelCatalogs } = modelCatalogRefresh;
const { checkForNewMsaVersion } = versionCheck;

export default abstract class InteractiveModeLayer48 extends InteractiveModeLayer47 {
  run(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* performed(this.runPart1());

        const { crash, initialMessage, initialImages, initialMessages } = this.runCrash();
        yield* performed(this.runPart3(crash, initialMessage, initialImages, initialMessages));
      }, this),
    );
  }

  protected runPart1(): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.init());

      if (readEnv("MSA_OFFLINE") === undefined || readEnv("MSA_OFFLINE") === "") {
        const controller = new AbortController();
        const timeout = schedule(() => controller.abort(), 15_000);
        Effect.runFork(
          awaitingWith(function* () {
            try {
              yield* awaited(refreshModelCatalogs(this.session.modelRuntime, controller.signal));
              this.updateAvailableProviderCount();
            } catch {
            } finally {
              timeout.cancel();
            }
          }, this),
        );
      }

      Effect.runFork(
        awaitingWith(function* () {
          const newRelease = yield* awaited(checkForNewMsaVersion(this.version));
          if (newRelease !== undefined) {
            this.showNewVersionNotification(newRelease);
          }
        }, this),
      );

      Effect.runFork(
        awaitingWith(function* () {
          try {
            const updates = yield* awaited(this.checkForPackageUpdates());
            if (updates.length > 0) {
              this.showPackageUpdateNotification(updates);
            }
          } finally {
            if (process.platform === "win32" && this.isInitialized) {
              this.updateTerminalTitle();
            }
          }
        }, this),
      );
    }, this);
  }
}
