import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import modelPolicy from "../../../../core/model-policy.ts";
import type modelSelectorInternalTypes from "../model-selector-internal.types.ts";
import type ModelSelectorComponent from "../model-selector.ts";

const { modelsAreEqual } = ai;
const { evaluateModelPolicy } = modelPolicy;

export default class ModelCatalog {
  private readonly selector: ModelSelectorComponent;

  constructor(selector: ModelSelectorComponent) {
    this.selector = selector;
  }

  loadModelsFromSnapshot(): void {
    const models = this.selector.modelRuntime
      .getAvailableSnapshot()
      .map((model: aiTypes.Model<any>) => ({
        id: model.id,
        model,
        provider: model.provider,
      }));
    this.selector.allModels = this.sortModels(models);
    this.selector.scopedModels = this.selector.scopedModels.map((scoped) => {
      const refreshed = this.selector.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
      return refreshed === undefined ? scoped : { ...scoped, model: refreshed };
    });
    this.selector.scopedModelItems = this.selector.scopedModels.map((scoped) => ({
      id: scoped.model.id,
      model: scoped.model,
      provider: scoped.model.provider,
    }));
    this.selector.hiddenModelItems = this.buildHiddenItems();
    this.syncScope();
    this.selector.activeModels = this.scopeItems(this.selector.scope);
    this.selector.filteredModels = this.selector.activeModels;
    const currentIndex = this.selector.filteredModels.findIndex((item) =>
      modelsAreEqual(this.selector.currentModel, item.model),
    );
    this.selector.selectedIndex =
      currentIndex >= 0
        ? currentIndex
        : Math.min(
            this.selector.selectedIndex,
            Math.max(0, this.selector.filteredModels.length - 1),
          );
  }

  private buildHiddenItems(): modelSelectorInternalTypes.ModelItem[] {
    const options = this.selector.policyOptions;
    if (options === undefined) return [];
    const policy = options.getPolicy();
    const items: modelSelectorInternalTypes.ModelItem[] = [];
    for (const model of options.getCatalogModels()) {
      if (!this.selector.modelRuntime.hasConfiguredAuth(model.provider)) continue;
      const decision = evaluateModelPolicy(policy, model);
      if (decision.allowed) continue;
      items.push({
        deniedBy: decision.reason === "deny" ? decision.pattern : "",
        id: model.id,
        model,
        provider: model.provider,
      });
    }
    return items.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  }

  private scopeItems(
    scope: modelSelectorInternalTypes.ModelScope,
  ): modelSelectorInternalTypes.ModelItem[] {
    if (scope === "scoped") return this.selector.scopedModelItems;
    if (scope === "hidden") return this.selector.hiddenModelItems;
    return this.selector.allModels;
  }

  availableScopes(): modelSelectorInternalTypes.ModelScope[] {
    const scopes: modelSelectorInternalTypes.ModelScope[] = ["all"];
    if (this.selector.scopedModelItems.length > 0) scopes.push("scoped");
    if ((this.selector.policyOptions && this.selector.hiddenModelItems.length > 0) === true)
      scopes.push("hidden");
    return scopes;
  }

  private syncScope(): void {
    if (this.availableScopes().includes(this.selector.scope)) return;
    this.selector.scope = "all";
  }

  private sortModels(
    models: modelSelectorInternalTypes.ModelItem[],
  ): modelSelectorInternalTypes.ModelItem[] {
    const sorted = [...models];

    sorted.sort((a, b) => {
      const aIsCurrent = modelsAreEqual(this.selector.currentModel, a.model);
      const bIsCurrent = modelsAreEqual(this.selector.currentModel, b.model);
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      const aIsDefault = this.isDefaultModel(a.model);
      const bIsDefault = this.isDefaultModel(b.model);
      if (aIsDefault && !bIsDefault) return -1;
      if (!aIsDefault && bIsDefault) return 1;
      return a.provider.localeCompare(b.provider);
    });
    return sorted;
  }

  isDefaultModel(model: aiTypes.Model<any>): boolean {
    return (
      this.selector.defaultModel?.provider === model.provider &&
      this.selector.defaultModel.id === model.id
    );
  }

  private setScope(scope: modelSelectorInternalTypes.ModelScope): void {
    if (this.selector.scope === scope) return;
    this.selector.scope = scope;
    this.selector.activeModels = this.scopeItems(scope);
    const currentIndex = this.selector.activeModels.findIndex((item) =>
      modelsAreEqual(this.selector.currentModel, item.model),
    );
    this.selector.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    this.selector.list.filterModels(this.selector.searchInput.getValue());
    if (this.selector.scopeText !== undefined) {
      this.selector.scopeText.setText(this.selector.list.getScopeText());
    }
  }

  cycleScope() {
    const scopes = this.availableScopes();
    if (scopes.length > 1) {
      const index = scopes.indexOf(this.selector.scope);
      const next = scopes[(index + 1) % scopes.length] ?? "all";
      this.setScope(next);
      this.selector.scopeText?.setText(this.selector.list.getScopeText());
      if (this.selector.scopeHintText !== undefined)
        this.selector.scopeHintText.setText(this.selector.list.getScopeHintText());
    }
  }
}
