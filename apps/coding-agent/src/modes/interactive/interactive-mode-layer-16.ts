import { Effect } from "effect";

import config from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import ProjectTrustStore from "../../core/project-trust-store.ts";
import errorsModule from "../../utils/errors.ts";
import type scopedModelsSelectorTypes from "./components/scoped-models-selector.types.ts";
import TrustSelectorComponent from "./components/trust-selector.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer15 from "./interactive-mode-layer-15.ts";
import modelCatalogRefresh from "./model-catalog-refresh.ts";

const { APP_NAME } = config;
const { refreshModelCatalogs } = modelCatalogRefresh;
const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;

export default abstract class InteractiveModeLayer16 extends InteractiveModeLayer15 {
  protected showTrustSelector(): void {
    const cwd = this.sessionManager.getCwd();
    const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
    const savedDecision = trustStore.getEntry(cwd);
    this.editorSlot.showSelector((done) => {
      const selector = new TrustSelectorComponent({
        cwd,
        onCancel: () => {
          done();
          this.ui.requestRender();
        },
        onSelect: (selection) => {
          trustStore.setMany(selection.updates);
          done();
          this.showStatus(
            `Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart ${APP_NAME} for this to take effect.`,
          );
        },
        projectTrusted: this.settingsManager.isProjectTrusted(),
        savedDecision,
      });
      return { component: selector, focus: selector };
    });
  }

  protected applyRefreshedCatalogs(
    state: interactiveModeInternalTypes.ScopedModelsState,
    selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent,
    result: Awaited<ReturnType<typeof refreshModelCatalogs>>,
  ): void {
    state.availableModels = [...this.session.modelRuntime.getAvailableSnapshot()];
    state.availableModelIds = new Set(
      state.availableModels.map((model) => `${model.provider}/${model.id}`),
    );
    if (!state.selectionChanged && state.sessionScopedModels.length === 0) {
      state.currentEnabledIds = state.configuredEnabledIds(state.availableModels);
      selector.updateModels(state.availableModels, state.currentEnabledIds);
    } else selector.updateModels(state.availableModels);
    if (state.currentEnabledIds !== null)
      this.applyScopedModelSelection(state, state.currentEnabledIds);
    if (result.aborted && state.timedOut)
      selector.setRefreshStatus("Model refresh timed out; showing cached models.", "warning");
    else if (result.errors.size > 0)
      selector.setRefreshStatus(
        `Could not refresh ${[...result.errors.keys()].join(", ")}; showing cached models.`,
        "warning",
      );
    else selector.setRefreshStatus("Model catalogs refreshed.", "success");
    this.ui.requestRender();
  }

  protected refreshScopedModelCatalogs(
    state: interactiveModeInternalTypes.ScopedModelsState,
    selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent,
    signal: AbortSignal,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        const result = yield* awaited(refreshModelCatalogs(this.session.modelRuntime, signal));
        if (!state.disposed) this.applyRefreshedCatalogs(state, selector, result);
      } catch (error: unknown) {
        if (state.disposed) return;
        selector.setRefreshStatus(
          state.timedOut
            ? "Model refresh timed out; showing cached models."
            : `Could not refresh model catalogs: ${toErrorMessage(error)}`,
          "warning",
        );
        this.ui.requestRender();
      }
    }, this);
  }
}
