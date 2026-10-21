import tuiModule from "@msa/tui";

import modelPolicy from "../../../../core/model-policy.ts";
import type modelPolicyTypes from "../../../../core/model-policy.types.ts";
import type modelSelectorInternalTypes from "../model-selector-internal.types.ts";
import type ModelSelectorComponent from "../model-selector.ts";

const { getKeybindings } = tuiModule;
const {
  evaluateModelPolicy,
  addModelPolicyPattern,
  allowModelReference,
  removeModelPolicyPattern,
} = modelPolicy;

export default class ModelInput {
  private readonly selector: ModelSelectorComponent;

  constructor(selector: ModelSelectorComponent) {
    this.selector = selector;
  }

  handle(keyData: string): void {
    const { selector } = this;
    const kb = getKeybindings();
    const policyEnabled = selector.policyOptions !== undefined;
    if (kb.matches(keyData, "tui.input.tab")) {
      selector.catalog.cycleScope();
    } else if (policyEnabled && kb.matches(keyData, "app.models.policy")) {
      this.toggleModelPolicy();
    } else if (policyEnabled && kb.matches(keyData, "app.models.toggleProvider")) {
      this.toggleProviderPolicy();
    } else if (kb.matches(keyData, "tui.select.up")) {
      this.moveSelection(-1);
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.moveSelection(1);
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      this.confirmSelection();
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      selector.dispose();
      selector.onCancelCallback();
    } else if (
      kb.matches(keyData, "app.models.save") &&
      selector.onSelectAsDefaultCallback !== undefined
    ) {
      const selectedModel = selector.filteredModels[selector.selectedIndex];
      if (selectedModel !== undefined) {
        selector.dispose();
        selector.onSelectAsDefaultCallback(selectedModel.model);
      }
    } else {
      selector.searchInput.handleInput(keyData);
      selector.list.filterModels(selector.searchInput.getValue());
    }
  }

  private moveSelection(step: 1 | -1): void {
    const { selector } = this;
    const count = selector.filteredModels.length;
    if (count === 0) return;
    selector.selectedIndex = (selector.selectedIndex + step + count) % count;
    selector.list.updateList();
  }

  private confirmSelection(): void {
    const { selector } = this;
    const selectedModel = selector.filteredModels[selector.selectedIndex];
    if (selectedModel === undefined) return;
    if (selectedModel.deniedBy !== undefined) {
      selector.errorMessage = `${selectedModel.provider}/${selectedModel.id} denied by ${selectedModel.deniedBy || "the allow list"}`;
      selector.list.updateList();
      selector.tui.requestRender();
      return;
    }
    selector.handleSelect(selectedModel.model);
  }

  private toggleModelPolicy(): void {
    const options = this.selector.policyOptions;
    const item = this.selector.filteredModels[this.selector.selectedIndex];
    if (options === undefined || item === undefined) return;
    const reference = `${item.provider}/${item.id}`;
    const policy = options.getPolicy();
    const next =
      item.deniedBy === undefined
        ? addModelPolicyPattern(policy, "deny", reference)
        : allowModelReference(policy, reference);
    this.applyPolicy(options.savePolicy(next), reference, item);
  }

  private toggleProviderPolicy(): void {
    const options = this.selector.policyOptions;
    const item = this.selector.filteredModels[this.selector.selectedIndex];
    if (options === undefined || item === undefined) return;
    const pattern = `${item.provider}/*`;
    const policy = options.getPolicy();
    const denied = policy.deny.some((entry) => entry.toLowerCase() === pattern.toLowerCase());
    const next = denied
      ? removeModelPolicyPattern(policy, pattern)
      : addModelPolicyPattern(policy, "deny", pattern);
    this.applyPolicy(options.savePolicy(next), pattern, item);
  }

  private applyPolicy(
    policy: modelPolicyTypes.ModelPolicy,
    changed: string,
    item: modelSelectorInternalTypes.ModelItem,
  ): void {
    this.selector.errorMessage = undefined;
    this.selector.catalog.loadModelsFromSnapshot();
    this.selector.scopeText?.setText(this.selector.list.getScopeText());
    this.selector.list.filterModels(this.selector.searchInput.getValue());
    const refreshed = this.selector.filteredModels.find(
      (entry) => entry.provider === item.provider && entry.id === item.id,
    );
    if (refreshed !== undefined) {
      this.selector.selectedIndex = this.selector.filteredModels.indexOf(refreshed);
      this.selector.list.updateList();
    }
    const decision = evaluateModelPolicy(policy, item.model);
    const stillHidden =
      !decision.allowed && decision.reason === "deny" && decision.pattern !== changed;
    this.selector.refreshStatusMessage = decision.allowed
      ? `Allowed ${changed}`
      : stillHidden
        ? `${changed} denied; also hidden by ${decision.pattern}`
        : `Denied ${changed}`;
    this.selector.refreshStatusSuccess = decision.allowed;
    this.selector.list.updateList();
    this.selector.tui.requestRender();
  }
}
