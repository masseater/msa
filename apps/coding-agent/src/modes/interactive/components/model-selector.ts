import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import {
  type ModelPolicy,
  addModelPolicyPattern,
  allowModelReference,
  evaluateModelPolicy,
  removeModelPolicyPattern,
} from "../../../core/model-policy.ts";
import type { ModelRuntime } from "../../../core/model-runtime.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { refreshModelCatalogs } from "../model-catalog-refresh.ts";
import { getModelSelectorSearchText } from "../model-search.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText, keyHint } from "./keybinding-hints.ts";

const { modelsAreEqual } = ai;

const { Container, Input, Spacer, Text, fuzzyFilter, getKeybindings } = tuiModule;

interface ModelItem {
  provider: string;
  id: string;
  model: aiTypes.Model<any>;

  deniedBy?: string | undefined;
}

export interface ModelSelectorPolicyOptions {
  getPolicy(): ModelPolicy;

  getCatalogModels(): readonly aiTypes.Model<any>[];

  savePolicy(policy: ModelPolicy): ModelPolicy;
}

interface ScopedModelItem {
  model: aiTypes.Model<any>;
  thinkingLevel?: string | undefined;
}

interface DefaultModelReference {
  provider: string;
  id: string;
}

type ModelScope = "all" | "scoped" | "hidden";

export class ModelSelectorComponent extends Container implements tuiTypes.Focusable {
  private searchInput: tuiTypes.Input;

  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }
  private listContainer: tuiTypes.Container;
  private allModels: ModelItem[] = [];
  private scopedModelItems: ModelItem[] = [];
  private hiddenModelItems: ModelItem[] = [];
  private activeModels: ModelItem[] = [];
  private filteredModels: ModelItem[] = [];
  private selectedIndex: number = 0;
  private currentModel?: aiTypes.Model<any> | undefined;
  private modelRuntime: ModelRuntime;
  private onSelectCallback: (model: aiTypes.Model<any>) => void;
  private onSelectAsDefaultCallback?: ((model: aiTypes.Model<any>) => void) | undefined;
  private onCancelCallback: () => void;
  private errorMessage?: string | undefined;
  private refreshStatusMessage = "Refreshing model catalogs…";
  private refreshStatusSuccess = false;
  private tui: tuiTypes.TUI;
  private scopedModels: ReadonlyArray<ScopedModelItem>;
  private defaultModel?: DefaultModelReference | undefined;
  private policyOptions?: ModelSelectorPolicyOptions | undefined;
  private scope: ModelScope = "all";
  private scopeText?: tuiTypes.Text;
  private scopeHintText?: tuiTypes.Text;
  private policyHintText?: tuiTypes.Text;
  private readonly refreshAbortController = new AbortController();
  private refreshTimeout?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    tui: tuiTypes.TUI,
    currentModel: aiTypes.Model<any> | undefined,
    modelRuntime: ModelRuntime,
    scopedModels: ReadonlyArray<ScopedModelItem>,
    onSelect: (model: aiTypes.Model<any>) => void,
    onCancel: () => void,
    initialSearchInput?: string,
    onSelectAsDefault?: (model: aiTypes.Model<any>) => void,
    defaultModel?: DefaultModelReference,
    policyOptions?: ModelSelectorPolicyOptions,
  ) {
    super();

    this.tui = tui;
    this.policyOptions = policyOptions;
    this.currentModel = currentModel;
    this.modelRuntime = modelRuntime;
    this.scopedModels = scopedModels;
    this.defaultModel = defaultModel;
    this.scope = scopedModels.length > 0 ? "scoped" : "all";
    this.onSelectCallback = onSelect;
    this.onSelectAsDefaultCallback = onSelectAsDefault;
    this.onCancelCallback = onCancel;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    if (scopedModels.length > 0 || policyOptions) {
      this.scopeText = new Text(this.getScopeText(), 0, 0);
      this.addChild(this.scopeText);
      this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
      this.addChild(this.scopeHintText);
    } else {
      const hintText =
        "Only showing models from configured providers. Use /login to add providers.";
      this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
    }
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    if (initialSearchInput) {
      this.searchInput.setValue(initialSearchInput);
    }
    this.searchInput.onSubmit = () => {
      const selected = this.filteredModels[this.selectedIndex];
      if (selected) {
        this.handleSelect(selected.model);
      }
    };
    this.addChild(this.searchInput);

    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));

    if (this.onSelectAsDefaultCallback) {
      this.addChild(
        new Text(
          theme.fg(
            "dim",
            `  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.models.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
          ),
          0,
          0,
        ),
      );
    }

    if (policyOptions) {
      this.policyHintText = new Text(this.getPolicyHintText(), 0, 0);
      this.addChild(this.policyHintText);
    }

    this.addChild(new DynamicBorder());

    this.loadModelsFromSnapshot();
    if (initialSearchInput) this.filterModels(initialSearchInput);
    else this.updateList();
    this.tui.requestRender();
    void this.refreshModels();
  }

  private loadModelsFromSnapshot(): void {
    const models = this.modelRuntime.getAvailableSnapshot().map((model: aiTypes.Model<any>) => ({
      id: model.id,
      model,
      provider: model.provider,
    }));
    this.allModels = this.sortModels(models);
    this.scopedModels = this.scopedModels.map((scoped) => {
      const refreshed = this.modelRuntime.getModel(scoped.model.provider, scoped.model.id);
      return refreshed ? { ...scoped, model: refreshed } : scoped;
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

  private buildHiddenItems(): ModelItem[] {
    const options = this.policyOptions;
    if (!options) return [];
    const policy = options.getPolicy();
    const items: ModelItem[] = [];
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

  private scopeItems(scope: ModelScope): ModelItem[] {
    if (scope === "scoped") return this.scopedModelItems;
    if (scope === "hidden") return this.hiddenModelItems;
    return this.allModels;
  }

  private availableScopes(): ModelScope[] {
    const scopes: ModelScope[] = ["all"];
    if (this.scopedModelItems.length > 0) scopes.push("scoped");
    if (this.policyOptions && this.hiddenModelItems.length > 0) scopes.push("hidden");
    return scopes;
  }

  private syncScope(): void {
    if (this.availableScopes().includes(this.scope)) return;
    this.scope = "all";
  }

  private async refreshModels(): Promise<void> {
    const timeoutMs = 15_000;
    let timedOut = false;
    this.refreshTimeout = setTimeout(() => {
      timedOut = true;
      this.refreshAbortController.abort();
    }, timeoutMs);
    try {
      const result = await refreshModelCatalogs(
        this.modelRuntime,
        this.refreshAbortController.signal,
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
        if (!this.errorMessage) {
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
      if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshAbortController.abort();
  }

  private sortModels(models: ModelItem[]): ModelItem[] {
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

  private getScopeText(): string {
    const labels = this.availableScopes().map((scope) =>
      scope === this.scope ? theme.fg("accent", scope) : theme.fg("muted", scope),
    );
    return `${theme.fg("muted", "Scope: ")}${labels.join(theme.fg("muted", " | "))}`;
  }

  private getScopeHintText(): string {
    return keyHint("tui.input.tab", "scope");
  }

  private getPolicyHintText(): string {
    const selected = this.filteredModels[this.selectedIndex];
    const verb = selected?.deniedBy === undefined ? "deny" : "allow";
    return theme.fg(
      "dim",
      `  ${keyDisplayText("app.models.policy")} ${verb} · ${keyDisplayText("app.models.toggleProvider")} provider`,
    );
  }

  private isDefaultModel(model: aiTypes.Model<any>): boolean {
    return this.defaultModel?.provider === model.provider && this.defaultModel.id === model.id;
  }

  private isDefaultSearch(query: string): boolean {
    const normalized = query.trim().toLowerCase();
    return normalized.length > 0 && "default".startsWith(normalized);
  }

  private setScope(scope: ModelScope): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.activeModels = this.scopeItems(scope);
    const currentIndex = this.activeModels.findIndex((item) =>
      modelsAreEqual(this.currentModel, item.model),
    );
    this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
    this.filterModels(this.searchInput.getValue());
    if (this.scopeText) {
      this.scopeText.setText(this.getScopeText());
    }
  }

  private filterModels(query: string): void {
    if (query) {
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
    } else {
      this.filteredModels = this.activeModels;
    }

    this.selectedIndex = query
      ? 0
      : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
    this.updateList();
  }

  private updateList(): void {
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

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredModels[i];
      if (!item) continue;

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

    if (this.errorMessage) {
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
    if (this.refreshStatusMessage) {
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

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.input.tab")) {
      const scopes = this.availableScopes();
      if (scopes.length > 1) {
        const index = scopes.indexOf(this.scope);
        const next = scopes[(index + 1) % scopes.length] ?? "all";
        this.setScope(next);
        this.scopeText?.setText(this.getScopeText());
        if (this.scopeHintText) this.scopeHintText.setText(this.getScopeHintText());
      }
      return;
    }
    if (this.policyOptions && kb.matches(keyData, "app.models.policy")) {
      this.toggleModelPolicy();
      return;
    }
    if (this.policyOptions && kb.matches(keyData, "app.models.toggleProvider")) {
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
      if (!selectedModel) return;
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
    } else if (kb.matches(keyData, "app.models.save") && this.onSelectAsDefaultCallback) {
      const selectedModel = this.filteredModels[this.selectedIndex];
      if (selectedModel) {
        this.dispose();
        this.onSelectAsDefaultCallback(selectedModel.model);
      }
    } else {
      this.searchInput.handleInput(keyData);
      this.filterModels(this.searchInput.getValue());
    }
  }

  private handleSelect(model: aiTypes.Model<any>): void {
    this.dispose();
    this.onSelectCallback(model);
  }

  private toggleModelPolicy(): void {
    const options = this.policyOptions;
    const item = this.filteredModels[this.selectedIndex];
    if (!options || !item) return;
    const reference = `${item.provider}/${item.id}`;
    const policy = options.getPolicy();
    const next =
      item.deniedBy === undefined
        ? addModelPolicyPattern(policy, "deny", reference)
        : allowModelReference(policy, reference);
    this.applyPolicy(options.savePolicy(next), reference, item);
  }

  private toggleProviderPolicy(): void {
    const options = this.policyOptions;
    const item = this.filteredModels[this.selectedIndex];
    if (!options || !item) return;
    const pattern = `${item.provider}/*`;
    const policy = options.getPolicy();
    const denied = policy.deny.some((entry) => entry.toLowerCase() === pattern.toLowerCase());
    const next = denied
      ? removeModelPolicyPattern(policy, pattern)
      : addModelPolicyPattern(policy, "deny", pattern);
    this.applyPolicy(options.savePolicy(next), pattern, item);
  }

  private applyPolicy(policy: ModelPolicy, changed: string, item: ModelItem): void {
    this.errorMessage = undefined;
    this.loadModelsFromSnapshot();
    this.scopeText?.setText(this.getScopeText());
    this.filterModels(this.searchInput.getValue());
    const refreshed = this.filteredModels.find(
      (entry) => entry.provider === item.provider && entry.id === item.id,
    );
    if (refreshed) {
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

  getSearchInput(): tuiTypes.Input {
    return this.searchInput;
  }
}
