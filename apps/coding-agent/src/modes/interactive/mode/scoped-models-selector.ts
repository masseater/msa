import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import modelResolver from "../../../core/model-resolver.ts";
import platformModule from "../../../core/platform.ts";
import errorsModule from "../../../utils/errors.ts";
import ScopedModelsSelectorComponent from "../components/scoped-models-selector.ts";
import type scopedModelsSelectorTypes from "../components/scoped-models-selector.types.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import modelCatalogRefresh from "../model-catalog-refresh.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { schedule } = platformModule;
const { resolveModelScopeFromModels } = modelResolver;
const { refreshModelCatalogs } = modelCatalogRefresh;

export default class ScopedModelsSelector {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private persistScopedModels(
    state: interactiveModeInternalTypes.ScopedModelsState,
    enabledIds: string[] | null,
  ): void {
    const allEnabled =
      enabledIds !== null &&
      enabledIds.length === state.availableModels.length &&
      enabledIds.every((id) => state.availableModelIds.has(id));
    const newPatterns = enabledIds === null || allEnabled ? undefined : enabledIds;
    this.mode.settingsManager.models.setEnabledModels(
      newPatterns === undefined ? undefined : [...newPatterns],
    );
    this.mode.display.status.showStatus("Model selection saved to settings");
  }

  private applyScopedModelSelection(
    state: interactiveModeInternalTypes.ScopedModelsState,
    enabledIds: string[] | null,
  ): void {
    state.currentEnabledIds = enabledIds === null ? null : [...enabledIds];
    const { availableModelIds } = state;
    const hasEnabledAvailableModel = enabledIds?.some((id) => availableModelIds.has(id)) ?? false;
    const allAvailableModelsEnabled =
      enabledIds !== null && [...availableModelIds].every((id) => enabledIds.includes(id));
    if (enabledIds !== null && hasEnabledAvailableModel && !allAvailableModelsEnabled) {
      const { scopedModels } = resolveModelScopeFromModels(enabledIds, state.availableModels);
      this.mode.session.models.selection.setScopedModels(
        scopedModels.map((scoped) => ({
          model: scoped.model,
          thinkingLevel: scoped.thinkingLevel,
        })),
      );
    } else this.mode.session.models.selection.setScopedModels([]);
    this.mode.models.selector.updateAvailableProviderCount();
    this.mode.ui.requestRender();
  }

  private applyRefreshedCatalogs(
    state: interactiveModeInternalTypes.ScopedModelsState,
    selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent,
    result: Awaited<ReturnType<typeof refreshModelCatalogs>>,
  ): void {
    state.availableModels = [
      ...this.mode.session.models.selection.modelRuntime.getAvailableSnapshot(),
    ];
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
    this.mode.ui.requestRender();
  }

  private refreshScopedModelCatalogs(
    state: interactiveModeInternalTypes.ScopedModelsState,
    selector: scopedModelsSelectorTypes.ScopedModelsSelectorComponent,
    signal: AbortSignal,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        const result = yield* awaited(
          refreshModelCatalogs(this.mode.session.models.selection.modelRuntime, signal),
        );
        if (!state.disposed) this.applyRefreshedCatalogs(state, selector, result);
      } catch (error: unknown) {
        if (state.disposed) return;
        selector.setRefreshStatus(
          state.timedOut
            ? "Model refresh timed out; showing cached models."
            : `Could not refresh model catalogs: ${toErrorMessage(error)}`,
          "warning",
        );
        this.mode.ui.requestRender();
      }
    }, this);
  }

  showModelsSelector(): void {
    const state: interactiveModeInternalTypes.ScopedModelsState = {
      ...this.mode.models.scopedState.scopedModelSelectionState(),
      disposed: false,
      timedOut: false,
    };
    this.mode.editorSlot.showSelector((done) => {
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
            this.mode.ui.requestRender();
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
