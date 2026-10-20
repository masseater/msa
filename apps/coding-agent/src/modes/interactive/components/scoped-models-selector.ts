import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { getModelSearchText } from "../model-search.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

const { Container, Input, Key, Spacer, Text, fuzzyFilter, getKeybindings, matchesKey } = tui;

type EnabledIds = string[] | null;

function isEnabled(enabledIds: EnabledIds, id: string): boolean {
  return enabledIds === null || enabledIds.includes(id);
}

function normalizeEnabled(result: string[], allIds: string[]): EnabledIds {
  return result.length === allIds.length && result.every((id) => allIds.includes(id))
    ? null
    : result;
}

function toggle(enabledIds: EnabledIds, allIds: string[], id: string): EnabledIds {
  if (enabledIds === null) return allIds.filter((modelId) => modelId !== id);
  const index = enabledIds.indexOf(id);
  if (index >= 0) return [...enabledIds.slice(0, index), ...enabledIds.slice(index + 1)];
  return normalizeEnabled([...enabledIds, id], allIds);
}

function enableAll(enabledIds: EnabledIds, allIds: string[], targetIds?: string[]): EnabledIds {
  if (enabledIds === null) return null;
  const targets = targetIds ?? allIds;
  const result = [...enabledIds];
  for (const id of targets) {
    if (!result.includes(id)) result.push(id);
  }
  return normalizeEnabled(result, allIds);
}

function clearAll(enabledIds: EnabledIds, allIds: string[], targetIds?: string[]): EnabledIds {
  if (enabledIds === null) {
    return targetIds === undefined ? [] : allIds.filter((id) => !targetIds.includes(id));
  }
  const targets = new Set(targetIds ?? enabledIds);
  return enabledIds.filter((id) => !targets.has(id));
}

function move(enabledIds: EnabledIds, id: string, delta: number): EnabledIds {
  if (enabledIds === null) return null;
  const list = [...enabledIds];
  const index = list.indexOf(id);
  if (index < 0) return list;
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= list.length) return list;
  const moved = list[index];
  const displaced = list[newIndex];
  if (moved === undefined || displaced === undefined) return list;
  const result = [...list];
  result[index] = displaced;
  result[newIndex] = moved;
  return result;
}

function getSortedIds(enabledIds: EnabledIds, allIds: string[]): string[] {
  if (enabledIds === null) return allIds;
  const enabledSet = new Set(enabledIds);
  return [...enabledIds, ...allIds.filter((id) => !enabledSet.has(id))];
}

interface ModelItem {
  fullId: string;
  model: aiTypes.Model<any> | undefined;
  enabled: boolean;
}

export interface ModelsConfig {
  allModels: aiTypes.Model<any>[];
  enabledModelIds: string[] | null;
  refreshStatus?: string;
}

export interface ModelsCallbacks {
  onChange: (enabledModelIds: string[] | null) => void | Promise<void>;
  onPersist: (enabledModelIds: string[] | null) => void | Promise<void>;
  onCancel: () => void;
}

export class ScopedModelsSelectorComponent extends Container implements tuiTypes.Focusable {
  private modelsById: Map<string, aiTypes.Model<any>> = new Map();
  private allIds: string[] = [];
  private enabledIds: EnabledIds = null;
  private filteredItems: ModelItem[] = [];
  private selectedIndex = 0;
  private searchInput: tuiTypes.Input;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }
  private listContainer: tuiTypes.Container;
  private footerText: tuiTypes.Text;
  private callbacks: ModelsCallbacks;
  private maxVisible = 8;
  private isDirty = false;
  private refreshStatusText?: tuiTypes.Text;

  constructor(config: ModelsConfig, callbacks: ModelsCallbacks) {
    super();
    this.callbacks = callbacks;

    for (const model of config.allModels) {
      const fullId = `${model.provider}/${model.id}`;
      this.modelsById.set(fullId, model);
      this.allIds.push(fullId);
    }

    this.enabledIds = config.enabledModelIds === null ? null : [...config.enabledModelIds];
    this.filteredItems = this.buildItems();

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold("Model Configuration")), 0, 0));
    this.addChild(
      new Text(
        theme.fg(
          "muted",
          `Session-only. ${keyDisplayText("app.models.save")} to save to settings.`,
        ),
        0,
        0,
      ),
    );
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));
    if (config.refreshStatus !== undefined && config.refreshStatus !== "") {
      this.refreshStatusText = new Text(theme.fg("muted", `  ${config.refreshStatus}`), 0, 0);
      this.addChild(this.refreshStatusText);
    }
    this.footerText = new Text(this.getFooterText(), 0, 0);
    this.addChild(this.footerText);

    this.addChild(new DynamicBorder());
    this.updateList();
  }

  updateModels(models: readonly aiTypes.Model<any>[], enabledModelIds?: string[] | null): void {
    const selectedId = this.filteredItems[this.selectedIndex]?.fullId;
    if (enabledModelIds !== undefined)
      this.enabledIds = enabledModelIds === null ? null : [...enabledModelIds];
    this.modelsById.clear();
    this.allIds = [];
    for (const model of models) {
      const fullId = `${model.provider}/${model.id}`;
      this.modelsById.set(fullId, model);
      this.allIds.push(fullId);
    }
    this.refresh();
    const refreshedIndex =
      selectedId !== undefined && selectedId !== ""
        ? this.filteredItems.findIndex((item) => item.fullId === selectedId)
        : -1;
    if (refreshedIndex >= 0) {
      this.selectedIndex = refreshedIndex;
      this.updateList();
    }
  }

  setRefreshStatus(message: string, kind: "muted" | "success" | "warning"): void {
    this.refreshStatusText?.setText(theme.fg(kind, `  ${message}`));
  }

  private buildItems(): ModelItem[] {
    return getSortedIds(this.enabledIds, this.allIds).map((id) => ({
      enabled: isEnabled(this.enabledIds, id),
      fullId: id,
      model: this.modelsById.get(id),
    }));
  }

  private getFooterText(): string {
    const enabledCount =
      this.enabledIds?.filter((id) => this.modelsById.has(id)).length ?? this.allIds.length;
    const unavailableCount = this.enabledIds?.filter((id) => !this.modelsById.has(id)).length ?? 0;
    const allEnabled = this.enabledIds === null;
    const countText = allEnabled
      ? "all enabled"
      : `${enabledCount}/${this.allIds.length} enabled${unavailableCount === 0 ? "" : ` · ${unavailableCount} unavailable`}`;
    const parts = [
      `${keyDisplayText("tui.select.confirm")} toggle`,
      `${keyDisplayText("app.models.enableAll")} all`,
      `${keyDisplayText("app.models.clearAll")} clear`,
      `${keyDisplayText("app.models.toggleProvider")} provider`,
      `${keyDisplayText("app.models.reorderUp")}/${keyDisplayText("app.models.reorderDown")} reorder`,
      `${keyDisplayText("app.models.save")} save`,
      countText,
    ];
    return this.isDirty
      ? theme.fg("dim", `  ${parts.join(" · ")} `) + theme.fg("warning", "(unsaved)")
      : theme.fg("dim", `  ${parts.join(" · ")}`);
  }

  private refresh(): void {
    const query = this.searchInput.getValue();
    const items = this.buildItems();
    this.filteredItems =
      query === ""
        ? items
        : fuzzyFilter(items, query, (item) =>
            item.model === undefined
              ? item.fullId
              : getModelSearchText({
                  id: item.model.id,
                  name: item.model.name,
                  provider: item.model.provider,
                }),
          );
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
    this.updateList();
    this.footerText.setText(this.getFooterText());
  }

  private notifyChange(): void {
    this.callbacks.onChange(this.enabledIds === null ? null : [...this.enabledIds]);
  }

  private updateList(): void {
    this.listContainer.clear();

    if (this.filteredItems.length === 0) {
      this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
      return;
    }

    const selected = ScopedModelsSelectorComponent.updateListSelected(this);
    if (selected !== undefined) {
      this.listContainer.addChild(new Spacer(1));
      this.listContainer.addChild(
        new Text(
          theme.fg(
            "muted",
            `  ${selected.model === undefined ? "Model unavailable" : `Model Name: ${selected.model.name}`}`,
          ),
          0,
          0,
        ),
      );
    }
  }

  private static updateListSelected(self: ScopedModelsSelectorComponent): ModelItem | undefined {
    const startIndex = Math.max(
      0,
      Math.min(
        self.selectedIndex - Math.floor(self.maxVisible / 2),
        self.filteredItems.length - self.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + self.maxVisible, self.filteredItems.length);
    for (let i = startIndex; i < endIndex; i++) {
      const item = self.filteredItems[i]!;
      const isSelected = i === self.selectedIndex;
      const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
      const id = item.model?.id ?? item.fullId;
      const styledId = item.model === undefined ? theme.strikethrough(id) : id;
      const modelText = isSelected ? theme.fg("accent", styledId) : styledId;
      const providerBadge = theme.fg(
        "muted",
        item.model === undefined ? " [unavailable]" : ` [${item.model.provider}]`,
      );
      const status = item.model !== undefined && item.enabled ? theme.fg("accent", "✓ ") : "  ";
      self.listContainer.addChild(new Text(`${prefix}${status}${modelText}${providerBadge}`, 0, 0));
    }

    if (startIndex > 0 || endIndex < self.filteredItems.length) {
      self.listContainer.addChild(
        new Text(
          theme.fg("muted", `  (${self.selectedIndex + 1}/${self.filteredItems.length})`),
          0,
          0,
        ),
      );
    }

    const selected = self.filteredItems[self.selectedIndex];
    return selected;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
      this.updateList();
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateList();
      return;
    }

    const reorderUp = kb.matches(data, "app.models.reorderUp");
    const reorderDown = kb.matches(data, "app.models.reorderDown");
    if (reorderUp || reorderDown) {
      if (this.enabledIds === null) return;
      const item = this.filteredItems[this.selectedIndex];
      if (item !== undefined && isEnabled(this.enabledIds, item.fullId)) {
        const delta = reorderUp ? -1 : 1;
        const currentIndex = this.enabledIds.indexOf(item.fullId);
        const newIndex = currentIndex + delta;
        if (newIndex >= 0 && newIndex < this.enabledIds.length) {
          this.enabledIds = move(this.enabledIds, item.fullId, delta);
          this.isDirty = true;
          this.selectedIndex += delta;
          this.refresh();
          this.notifyChange();
        }
      }
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item !== undefined) {
        this.enabledIds = toggle(this.enabledIds, this.allIds, item.fullId);
        this.isDirty = true;
        this.refresh();
        this.notifyChange();
      }
      return;
    }

    if (kb.matches(data, "app.models.enableAll")) {
      const targetIds =
        this.searchInput.getValue() === "" ? undefined : this.filteredItems.map((i) => i.fullId);
      this.enabledIds = enableAll(this.enabledIds, this.allIds, targetIds);
      this.isDirty = true;
      this.refresh();
      this.notifyChange();
      return;
    }

    if (kb.matches(data, "app.models.clearAll")) {
      const targetIds =
        this.searchInput.getValue() === "" ? undefined : this.filteredItems.map((i) => i.fullId);
      this.enabledIds = clearAll(this.enabledIds, this.allIds, targetIds);
      this.isDirty = true;
      this.refresh();
      this.notifyChange();
      return;
    }

    if (kb.matches(data, "app.models.toggleProvider")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item?.model !== undefined) {
        const provider = item.model.provider;
        const providerIds = this.allIds.filter(
          (id) => this.modelsById.get(id)!.provider === provider,
        );
        const allEnabled = providerIds.every((id) => isEnabled(this.enabledIds, id));
        this.enabledIds = allEnabled
          ? clearAll(this.enabledIds, this.allIds, providerIds)
          : enableAll(this.enabledIds, this.allIds, providerIds);
        this.isDirty = true;
        this.refresh();
        this.notifyChange();
      }
      return;
    }

    if (kb.matches(data, "app.models.save")) {
      this.callbacks.onPersist(this.enabledIds === null ? null : [...this.enabledIds]);
      this.isDirty = false;
      this.footerText.setText(this.getFooterText());
      return;
    }

    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.searchInput.getValue() === "") {
        this.callbacks.onCancel();
      } else {
        this.searchInput.setValue("");
        this.refresh();
      }
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.callbacks.onCancel();
      return;
    }

    this.searchInput.handleInput(data);
    this.refresh();
  }

  getSearchInput(): tuiTypes.Input {
    return this.searchInput;
  }
}
