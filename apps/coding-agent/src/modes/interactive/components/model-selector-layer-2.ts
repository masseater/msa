import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import modelPolicy from "../../../core/model-policy.ts";
import type modelPolicyTypes from "../../../core/model-policy.types.ts";
import errorsModule from "../../../utils/errors.ts";
import modelCatalogRefresh from "../model-catalog-refresh.ts";
import type modelSelectorInternalTypes from "./model-selector-internal.types.ts";
import ModelSelectorComponentLayer1 from "./model-selector-layer-1.ts";

const { awaited, awaitingWith } = awaitingModule;
const { refreshModelCatalogs } = modelCatalogRefresh;
const { toErrorMessage } = errorsModule;
const { getKeybindings } = tuiModule;
const {
  addModelPolicyPattern,
  allowModelReference,
  evaluateModelPolicy,
  removeModelPolicyPattern,
} = modelPolicy;

export default abstract class ModelSelectorComponentLayer2 extends ModelSelectorComponentLayer1 {
  protected refreshModels(): Promise<void> {
    return Effect.runPromise(awaitingWith(this)(this.refreshModelsSteps));
  }

  protected *refreshModelsSteps(this: ModelSelectorComponentLayer2) {
    const timeoutMs = 15_000;
    let timedOut = false;
    this.refreshTimeout = Effect.runFork(
      Effect.andThen(
        Effect.sleep(timeoutMs),
        Effect.sync(() => {
          timedOut = true;
          this.refreshAbortController.abort();
        }),
      ),
    );
    try {
      const result = yield* awaited(
        refreshModelCatalogs(this.modelRuntime, this.refreshAbortController.signal),
      );
      if (this.closed) return;
      this.refreshStatusMessage = "";
      if (result.aborted && timedOut) {
        this.errorMessage = "Model refresh timed out; showing cached models.";
      } else if (result.errors.size === 1) {
        this.errorMessage = `Could not refresh ${result.errors.keys().next().value}; showing cached models.`;
      } else if (result.errors.size > 1) {
        this.errorMessage = `Could not refresh ${result.errors.size} model catalogs (${[...result.errors.keys()].join(", ")}); showing cached models.`;
      } else {
        this.errorMessage = this.modelRuntime.getError();
        if (this.errorMessage === undefined || this.errorMessage === "") {
          this.refreshStatusMessage = "Model catalogs refreshed.";
          this.refreshStatusSuccess = true;
        }
      }
      this.loadModelsFromSnapshot();
      this.filterModels(this.searchInput.getValue());
      this.tui.requestRender();
    } catch (error) {
      if (this.closed) return;
      this.refreshStatusMessage = "";
      this.errorMessage = timedOut
        ? "Model refresh timed out; showing cached models."
        : `Could not refresh model catalogs: ${toErrorMessage(error)}`;
      this.updateList();
      this.tui.requestRender();
    } finally {
      this.stopRefreshTimeout();
    }
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.input.tab")) {
      return this.handleInputPart1();
    }
    if ((this.policyOptions && kb.matches(keyData, "app.models.policy")) === true) {
      this.toggleModelPolicy();
      return;
    }
    if ((this.policyOptions && kb.matches(keyData, "app.models.toggleProvider")) === true) {
      this.toggleProviderPolicy();
      return;
    }

    if (kb.matches(keyData, "tui.select.up")) {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.down")) {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selectedModel = this.filteredModels[this.selectedIndex];
      if (selectedModel === undefined) return;
      if (selectedModel.deniedBy !== undefined) {
        this.errorMessage = `${selectedModel.provider}/${selectedModel.id} denied by ${selectedModel.deniedBy || "the allow list"}`;
        this.updateList();
        this.tui.requestRender();
        return;
      }
      this.handleSelect(selectedModel.model);
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.dispose();
      this.onCancelCallback();
    } else if (
      kb.matches(keyData, "app.models.save") &&
      this.onSelectAsDefaultCallback !== undefined
    ) {
      const selectedModel = this.filteredModels[this.selectedIndex];
      if (selectedModel !== undefined) {
        this.dispose();
        this.onSelectAsDefaultCallback(selectedModel.model);
      }
    } else {
      this.searchInput.handleInput(keyData);
      this.filterModels(this.searchInput.getValue());
    }
  }

  protected handleInputPart1() {
    const scopes = this.availableScopes();
    if (scopes.length > 1) {
      const index = scopes.indexOf(this.scope);
      const next = scopes[(index + 1) % scopes.length] ?? "all";
      this.setScope(next);
      this.scopeText?.setText(this.getScopeText());
      if (this.scopeHintText !== undefined) this.scopeHintText.setText(this.getScopeHintText());
    }
  }

  protected toggleModelPolicy(): void {
    const options = this.policyOptions;
    const item = this.filteredModels[this.selectedIndex];
    if (options === undefined || item === undefined) return;
    const reference = `${item.provider}/${item.id}`;
    const policy = options.getPolicy();
    const next =
      item.deniedBy === undefined
        ? addModelPolicyPattern(policy, "deny", reference)
        : allowModelReference(policy, reference);
    this.applyPolicy(options.savePolicy(next), reference, item);
  }

  protected toggleProviderPolicy(): void {
    const options = this.policyOptions;
    const item = this.filteredModels[this.selectedIndex];
    if (options === undefined || item === undefined) return;
    const pattern = `${item.provider}/*`;
    const policy = options.getPolicy();
    const denied = policy.deny.some((entry) => entry.toLowerCase() === pattern.toLowerCase());
    const next = denied
      ? removeModelPolicyPattern(policy, pattern)
      : addModelPolicyPattern(policy, "deny", pattern);
    this.applyPolicy(options.savePolicy(next), pattern, item);
  }

  protected applyPolicy(
    policy: modelPolicyTypes.ModelPolicy,
    changed: string,
    item: modelSelectorInternalTypes.ModelItem,
  ): void {
    this.errorMessage = undefined;
    this.loadModelsFromSnapshot();
    this.scopeText?.setText(this.getScopeText());
    this.filterModels(this.searchInput.getValue());
    const refreshed = this.filteredModels.find(
      (entry) => entry.provider === item.provider && entry.id === item.id,
    );
    if (refreshed !== undefined) {
      this.selectedIndex = this.filteredModels.indexOf(refreshed);
      this.updateList();
    }
    const decision = evaluateModelPolicy(policy, item.model);
    const stillHidden =
      !decision.allowed && decision.reason === "deny" && decision.pattern !== changed;
    this.refreshStatusMessage = decision.allowed
      ? `Allowed ${changed}`
      : stillHidden
        ? `${changed} denied; also hidden by ${decision.pattern}`
        : `Denied ${changed}`;
    this.refreshStatusSuccess = decision.allowed;
    this.updateList();
    this.tui.requestRender();
  }
}
