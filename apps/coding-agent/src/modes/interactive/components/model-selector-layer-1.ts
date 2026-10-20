import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, Fiber } from "effect";

import modelPolicy from "../../../core/model-policy.ts";
import modelSearch from "../model-search.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import type modelSelectorInternalTypes from "./model-selector-internal.types.ts";
import ModelSelectorComponentLayer0 from "./model-selector-layer-0.ts";

const { modelsAreEqual } = ai;
const { evaluateModelPolicy } = modelPolicy;
const { theme } = themeModule;
const { keyDisplayText, keyHint } = keybindingHints;
const { Spacer, Text, fuzzyFilter } = tuiModule;
const { getModelSelectorSearchText } = modelSearch;

export default abstract class ModelSelectorComponentLayer1 extends ModelSelectorComponentLayer0 {
  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  protected loadModelsFromSnapshot(): void {
    const models = this.modelRuntime.getAvailableSnapshot().map((model: aiTypes.Model<any>) => ({
      id: model.id,
      model,
      provider: model.provider,
    }));
    this.allModels = this.sortModels(models);
    this.scopedModels = this.scopedModels.map((scoped) => {
      const refreshed = this.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
      return refreshed === undefined ? scoped : { ...scoped, model: refreshed };
    });
    this.scopedModelItems = this.scopedModels.map((scoped) => ({
      id: scoped.model.id,
      model: scoped.model,
      provider: scoped.model.provider,
    }));
    this.hiddenModelItems = this.buildHiddenItems();
    this.syncScope();
    this.activeModels = this.scopeItems(this.scope);
    this.filteredModels = this.activeModels;
    const currentIndex = this.filteredModels.findIndex((item) =>
      modelsAreEqual(this.currentModel, item.model),
    );
    this.selectedIndex =
      currentIndex >= 0
        ? currentIndex
        : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
  }

  protected buildHiddenItems(): modelSelectorInternalTypes.ModelItem[] {
    const options = this.policyOptions;
    if (options === undefined) return [];
    const policy = options.getPolicy();
    const items: modelSelectorInternalTypes.ModelItem[] = [];
    for (const model of options.getCatalogModels()) {
      if (!this.modelRuntime.hasConfiguredAuth(model.provider)) continue;
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

  protected scopeItems(
    scope: modelSelectorInternalTypes.ModelScope,
  ): modelSelectorInternalTypes.ModelItem[] {
    if (scope === "scoped") return this.scopedModelItems;
    if (scope === "hidden") return this.hiddenModelItems;
    return this.allModels;
  }

  protected availableScopes(): modelSelectorInternalTypes.ModelScope[] {
    const scopes: modelSelectorInternalTypes.ModelScope[] = ["all"];
    if (this.scopedModelItems.length > 0) scopes.push("scoped");
    if ((this.policyOptions && this.hiddenModelItems.length > 0) === true) scopes.push("hidden");
    return scopes;
  }

  protected syncScope(): void {
    if (this.availableScopes().includes(this.scope)) return;
    this.scope = "all";
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopRefreshTimeout();
    this.refreshAbortController.abort();
  }

  protected stopRefreshTimeout(): void {
    const timeout = this.refreshTimeout;
    this.refreshTimeout = undefined;
    if (timeout !== undefined) Effect.runFork(Fiber.interrupt(timeout));
  }

  protected sortModels(
    models: modelSelectorInternalTypes.ModelItem[],
  ): modelSelectorInternalTypes.ModelItem[] {
    const sorted = [...models];

    sorted.sort((a, b) => {
      const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
      const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
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

  protected getScopeText(): string {
    const labels = this.availableScopes().map((scope) =>
      scope === this.scope ? theme.fg("accent", scope) : theme.fg("muted", scope),
    );
    return `${theme.fg("muted", "Scope: ")}${labels.join(theme.fg("muted", " | "))}`;
  }

  protected getScopeHintText(): string {
    return keyHint("tui.input.tab", "scope");
  }

  protected getPolicyHintText(): string {
    const selected = this.filteredModels[this.selectedIndex];
    const verb = selected?.deniedBy === undefined ? "deny" : "allow";
    return theme.fg(
      "dim",
      `  ${keyDisplayText("app.models.policy")} ${verb} · ${keyDisplayText("app.models.toggleProvider")} provider`,
    );
  }

  protected isDefaultModel(model: aiTypes.Model<any>): boolean {
    return this.defaultModel?.provider === model.provider && this.defaultModel.id === model.id;
  }

  protected isDefaultSearch(query: string): boolean {
    const normalized = query.trim().toLowerCase();
    return normalized.length > 0 && "default".startsWith(normalized);
  }

  protected setScope(scope: modelSelectorInternalTypes.ModelScope): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.activeModels = this.scopeItems(scope);
    const currentIndex = this.activeModels.findIndex((item) =>
      modelsAreEqual(this.currentModel, item.model),
    );
    this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    this.filterModels(this.searchInput.getValue());
    if (this.scopeText !== undefined) {
      this.scopeText.setText(this.getScopeText());
    }
  }

  protected filterModels(query: string): void {
    if (query === "") {
      this.filteredModels = this.activeModels;
    } else {
      const filtered = fuzzyFilter(this.activeModels, query, (item) => {
        const defaultText = this.isDefaultModel(item.model) ? " default" : "";
        return `${getModelSelectorSearchText({ id: item.id, name: item.model.name, provider: item.provider })}${defaultText}`;
      });
      if (this.isDefaultSearch(query)) {
        const defaultItems = this.activeModels.filter((item) => this.isDefaultModel(item.model));
        const defaultKeys = new Set(defaultItems.map((item) => `${item.provider}\0${item.id}`));
        this.filteredModels = [
          ...defaultItems,
          ...filtered.filter((item) => !defaultKeys.has(`${item.provider}\0${item.id}`)),
        ];
      } else {
        this.filteredModels = filtered;
      }
    }

    this.selectedIndex =
      query === "" ? Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1)) : 0;
    this.updateList();
  }

  protected updateList(): void {
    this.listContainer.clear();

    const maxVisible = 10;
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(maxVisible / 2),
        this.filteredModels.length - maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

    this.updateListPart1(startIndex, endIndex);

    if (this.errorMessage !== undefined && this.errorMessage !== "") {
      const errorLines = this.errorMessage.split("\n");
      for (const line of errorLines) {
        this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
      }
    } else if (this.filteredModels.length === 0) {
      this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
    } else {
      const selected = this.filteredModels[this.selectedIndex];
      if (selected !== undefined) {
        this.listContainer.addChild(new Spacer(1));
        this.listContainer.addChild(
          new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0),
        );
      }
    }
    this.policyHintText?.setText(this.getPolicyHintText());
    if (this.refreshStatusMessage !== "") {
      this.listContainer.addChild(new Spacer(1));
      this.listContainer.addChild(
        new Text(
          theme.fg(
            this.refreshStatusSuccess ? "success" : "muted",
            `  ${this.refreshStatusMessage}`,
          ),
          0,
          0,
        ),
      );
    }
  }

  protected updateListPart1(startIndex: number, endIndex: number) {
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredModels[i];
      if (item === undefined) continue;

      const isSelected = i === this.selectedIndex;
      const isCurrent = modelsAreEqual(this.currentModel, item.model);
      const isDefault = this.isDefaultModel(item.model);
      const defaultBadge = isDefault ? theme.fg("muted", " · default") : "";
      const denied = item.deniedBy !== undefined;

      const cursor = isSelected ? theme.fg("accent", "→ ") : "  ";
      const currentMarker = denied
        ? theme.fg("warning", "✕ ")
        : isCurrent
          ? theme.fg("accent", "✓ ")
          : "  ";
      const plainId = denied ? theme.fg("dim", theme.strikethrough(item.id)) : item.id;
      const modelText = isSelected ? theme.fg("accent", plainId) : plainId;
      const providerBadge = theme.fg("muted", `[${item.provider}]`);
      const deniedBadge = denied ? theme.fg("warning", ` · ${item.deniedBy || "allow list"}`) : "";
      const line = `${cursor}${currentMarker}${modelText} ${providerBadge}${defaultBadge}${deniedBadge}`;

      this.listContainer.addChild(new Text(line, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.filteredModels.length) {
      const scrollInfo = theme.fg(
        "muted",
        `  (${this.selectedIndex + 1}/${this.filteredModels.length})`,
      );
      this.listContainer.addChild(new Text(scrollInfo, 0, 0));
    }
  }

  protected handleSelect(model: aiTypes.Model<any>): void {
    this.dispose();
    this.onSelectCallback(model);
  }

  getSearchInput(): tuiTypes.Input {
    return this.searchInput;
  }
}
