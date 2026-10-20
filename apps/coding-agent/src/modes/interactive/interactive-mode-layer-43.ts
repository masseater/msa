import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import modelResolver from "../../core/model-resolver.ts";
import platformModule from "../../core/platform.ts";
import errorsModule from "../../utils/errors.ts";
import InteractiveModeLayer42 from "./interactive-mode-layer-42.ts";
import modelCatalogRefresh from "./model-catalog-refresh.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { findExactModelReferenceMatch, findModelPolicyDenial, formatModelPolicyDenialError } =
  modelResolver;
const { schedule } = platformModule;
const { refreshModelCatalogs } = modelCatalogRefresh;

export default abstract class InteractiveModeLayer43 extends InteractiveModeLayer42 {
  protected extensionCommandContextActions(): extensionsTypes.ExtensionCommandContextActions {
    return {
      fork: (entryId, options) => this.forkFromExtension(entryId, options),
      navigateTree: (targetId, options) => this.navigateTreeFromExtension(targetId, options),
      newSession: (options) => this.newSessionFromExtension(options),
      reload: () => this.handleReloadCommand(),
      switchSession: (sessionPath, options) =>
        Effect.runPromise(this.handleResumeSession(sessionPath, options)),
      waitForIdle: () => this.session.run.lifecycle.waitForIdle(),
    };
  }

  protected bindCurrentSessionExtensions(): Promise<void> {
    return this.session.extensions.binding
      .bindExtensions({
        abortHandler: () => {
          this.restoreQueuedMessagesToEditor({ abort: true });
        },
        commandContextActions: this.extensionCommandContextActions(),
        mode: "tui",
        onError: (error) => {
          this.showExtensionError(error.extensionPath, error.error, error.stack);
        },
        shutdownHandler: () => {
          this.shutdownRequested = true;
          if (this.session.isIdle) void this.shutdown();
        },
        uiContext: this.createExtensionUIContext(),
      })
      .then(() => this.bindCurrentSessionExtensionsPart1());
  }

  protected handleModelCommand(searchTerm?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (searchTerm === undefined || searchTerm === "") {
        this.showModelSelector();
        return;
      }
      if (searchTerm === "upgrade") {
        this.showModelUpgradeSelector();
        return;
      }

      const model = yield* awaited(this.findExactModelMatch(searchTerm));
      if (model !== undefined) {
        try {
          yield* awaited(this.session.models.selection.setModel(model, { persist: false }));
          this.footer.invalidate();
          this.updateEditorBorderColor();
          this.showStatus(`Model: ${model.id}`);
        } catch (error) {
          this.showError(toErrorMessage(error));
        }
        return;
      }

      const denial = findModelPolicyDenial({
        catalogModels: this.session.models.selection.modelRuntime.getCatalogModels(),
        policy: this.session.models.selection.modelRuntime.getModelPolicy(),
        reference: searchTerm,
      });
      if (denial !== undefined) {
        this.showError(formatModelPolicyDenialError(denial));
        return;
      }

      this.showModelSelector(searchTerm);
    }, this);
  }

  protected findExactModelMatch(searchTerm: string): Promise<compatTypes.Model<any> | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const cachedModels =
          this.session.models.selection.scopedModels.length > 0
            ? this.session.models.selection.scopedModels.map((scoped) => scoped.model)
            : [...this.session.models.selection.modelRuntime.getAvailableSnapshot()];
        const cachedMatch = findExactModelReferenceMatch(searchTerm, cachedModels);
        if (cachedMatch !== undefined || this.session.models.selection.scopedModels.length > 0)
          return cachedMatch;

        this.showStatus("Refreshing model catalogs…");
        const controller = new AbortController();
        let timedOut = false;
        const timeout = schedule(() => {
          timedOut = true;
          controller.abort();
        }, 15_000);
        try {
          const result = yield* awaited(
            refreshModelCatalogs(this.session.models.selection.modelRuntime, controller.signal),
          );
          if (result.aborted && timedOut) {
            this.showWarning("Model refresh timed out; searching cached models.");
          } else if (result.errors.size > 0) {
            this.showWarning(
              `Could not refresh ${[...result.errors.keys()].join(", ")}; searching cached models.`,
            );
          }
        } catch (error) {
          this.showWarning(
            timedOut
              ? "Model refresh timed out; searching cached models."
              : `Could not refresh model catalogs: ${toErrorMessage(error)}`,
          );
        } finally {
          timeout.cancel();
        }
        return findExactModelReferenceMatch(searchTerm, [
          ...this.session.models.selection.modelRuntime.getAvailableSnapshot(),
        ]);
      }, this),
    );
  }
}
