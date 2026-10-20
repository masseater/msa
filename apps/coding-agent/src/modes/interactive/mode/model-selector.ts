import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import modelPolicy from "../../../core/model-policy.ts";
import modelResolver from "../../../core/model-resolver.ts";
import platformModule from "../../../core/platform.ts";
import errorsModule from "../../../utils/errors.ts";
import ModelSelectorComponent from "../components/model-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";
import modelCatalogRefresh from "../model-catalog-refresh.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { schedule } = platformModule;
const { findExactModelReferenceMatch, findModelPolicyDenial, formatModelPolicyDenialError } =
  modelResolver;
const { saveModelPolicy } = modelPolicy;
const { refreshModelCatalogs } = modelCatalogRefresh;

export default class ModelSelector {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  updateAvailableProviderCount(): void {
    const models =
      this.mode.session.models.selection.scopedModels.length > 0
        ? this.mode.session.models.selection.scopedModels.map((scoped) => scoped.model)
        : this.mode.session.models.selection.modelRuntime.getAvailableSnapshot();
    const uniqueProviders = new Set(models.map((model) => model.provider));
    this.mode.layout.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
  }

  private configuredDefaultModel(): { id: string; provider: string } | undefined {
    const provider = this.mode.settingsManager.getDefaultProvider();
    const id = this.mode.settingsManager.getDefaultModel();
    return provider !== undefined && provider !== "" && id !== undefined && id !== ""
      ? { id, provider }
      : undefined;
  }

  private selectModelFromSelector(
    model: compatTypes.Model<any>,
    persist: boolean,
    done: () => void,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          yield* awaited(this.mode.session.models.selection.setModel(model, { persist }));
          this.updateAvailableProviderCount();
          this.mode.footer.invalidate();
          this.mode.input.keys.updateEditorBorderColor();
          done();
          this.mode.display.status.showStatus(
            persist ? `Default model: ${model.provider}/${model.id}` : `Model: ${model.id}`,
          );
        } catch (error) {
          done();
          this.mode.display.status.showError(toErrorMessage(error));
        }
      }, this),
    );
  }

  showModelSelector(initialSearchInput?: string): void {
    this.mode.editorSlot.showSelector((done) => {
      const runtime = this.mode.session.models.selection.modelRuntime;
      const selector = new ModelSelectorComponent(
        this.mode.ui,
        this.mode.session.model,
        runtime,
        this.mode.session.models.selection.scopedModels,
        (model) => this.selectModelFromSelector(model, false, done),
        () => {
          done();
          this.mode.ui.requestRender();
        },
        initialSearchInput,
        (model) => this.selectModelFromSelector(model, true, done),
        this.configuredDefaultModel(),
        {
          getCatalogModels: () => runtime.getCatalogModels(),
          getPolicy: () => runtime.getModelPolicy(),
          savePolicy: (policy) =>
            saveModelPolicy(
              { modelRuntime: runtime, settingsManager: this.mode.settingsManager },
              policy,
            ),
        },
      );
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }

  handleModelCommand(searchTerm?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (searchTerm === undefined || searchTerm === "") {
        this.showModelSelector();
        return;
      }
      if (searchTerm === "upgrade") {
        this.mode.models.upgrade.showModelUpgradeSelector();
        return;
      }

      const model = yield* awaited(this.findExactModelMatch(searchTerm));
      if (model !== undefined) {
        try {
          yield* awaited(this.mode.session.models.selection.setModel(model, { persist: false }));
          this.mode.footer.invalidate();
          this.mode.input.keys.updateEditorBorderColor();
          this.mode.display.status.showStatus(`Model: ${model.id}`);
        } catch (error) {
          this.mode.display.status.showError(toErrorMessage(error));
        }
        return;
      }

      const denial = findModelPolicyDenial({
        catalogModels: this.mode.session.models.selection.modelRuntime.getCatalogModels(),
        policy: this.mode.session.models.selection.modelRuntime.getModelPolicy(),
        reference: searchTerm,
      });
      if (denial !== undefined) {
        this.mode.display.status.showError(formatModelPolicyDenialError(denial));
        return;
      }

      this.showModelSelector(searchTerm);
    }, this);
  }

  findExactModelMatch(searchTerm: string): Promise<compatTypes.Model<any> | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const cachedModels =
          this.mode.session.models.selection.scopedModels.length > 0
            ? this.mode.session.models.selection.scopedModels.map((scoped) => scoped.model)
            : [...this.mode.session.models.selection.modelRuntime.getAvailableSnapshot()];
        const cachedMatch = findExactModelReferenceMatch(searchTerm, cachedModels);
        if (cachedMatch !== undefined || this.mode.session.models.selection.scopedModels.length > 0)
          return cachedMatch;

        this.mode.display.status.showStatus("Refreshing model catalogs…");
        const controller = new AbortController();
        let timedOut = false;
        const timeout = schedule(() => {
          timedOut = true;
          controller.abort();
        }, 15_000);
        try {
          const result = yield* awaited(
            refreshModelCatalogs(
              this.mode.session.models.selection.modelRuntime,
              controller.signal,
            ),
          );
          if (result.aborted && timedOut) {
            this.mode.display.status.showWarning(
              "Model refresh timed out; searching cached models.",
            );
          } else if (result.errors.size > 0) {
            this.mode.display.status.showWarning(
              `Could not refresh ${[...result.errors.keys()].join(", ")}; searching cached models.`,
            );
          }
        } catch (error) {
          this.mode.display.status.showWarning(
            timedOut
              ? "Model refresh timed out; searching cached models."
              : `Could not refresh model catalogs: ${toErrorMessage(error)}`,
          );
        } finally {
          timeout.cancel();
        }
        return findExactModelReferenceMatch(searchTerm, [
          ...this.mode.session.models.selection.modelRuntime.getAvailableSnapshot(),
        ]);
      }, this),
    );
  }
}
