import { Effect } from "effect";

import config from "../../config.ts";
import platformModule from "../../core/platform.ts";
import shell from "../../utils/shell.ts";
import ScopedModelsSelectorComponent from "./components/scoped-models-selector.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer21 from "./interactive-mode-layer-21.ts";

const { killTrackedDetachedChildren } = shell;
const { schedule, writeError } = platformModule;
const { APP_NAME } = config;
const { isDeadTerminalError } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer22 extends InteractiveModeLayer21 {
  protected uncaughtCrash(error: Error): never {
    if (isDeadTerminalError(error)) {
      this.emergencyTerminalExit();
    }
    if (this.isShuttingDown) {
      process.exit(1);
    }
    this.isShuttingDown = true;
    try {
      this.unregisterSignalHandlers();
    } catch {}
    try {
      killTrackedDetachedChildren();
    } catch {}
    try {
      this.ui.stop();
    } catch {}
    writeError(`${APP_NAME} exiting due to uncaughtException:`);
    writeError(error);
    const extensionHint = this.getCrashExtensionHint(error);
    if (extensionHint !== undefined && extensionHint !== "") writeError(`\n${extensionHint}`);
    if (this.recordCrash("uncaught_exception", error)) {
      writeError(`\n${this.crashReportInstructions()}`);
    }
    process.exit(1);
  }

  protected showModelsSelector(): void {
    const state: interactiveModeInternalTypes.ScopedModelsState = {
      ...this.showModelsSelectorCurrentEnabledIds(),
      disposed: false,
      timedOut: false,
    };
    this.editorSlot.showSelector((done) => {
      const controller = new AbortController();
      const timeout = schedule(() => {
        state.timedOut = true;
        controller.abort();
      }, 15_000);
      const selector = new ScopedModelsSelectorComponent(
        {
          allModels: state.availableModels,
          enabledModelIds: state.currentEnabledIds,
          refreshStatus: "Refreshing model catalogs…",
        },
        {
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
          onChange: (enabledIds) => {
            state.selectionChanged = true;
            this.applyScopedModelSelection(state, enabledIds);
          },
          onPersist: (enabledIds) => this.persistScopedModels(state, enabledIds),
        },
      );
      Effect.runFork(
        this.refreshScopedModelCatalogs(state, selector, controller.signal).pipe(
          Effect.ensuring(Effect.sync(() => timeout.cancel())),
        ),
      );
      const dispose = () => {
        state.disposed = true;
        timeout.cancel();
        controller.abort();
      };
      return { component: selector, dispose, focus: selector };
    });
  }
}
