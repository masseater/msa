import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import modelSearch from "../model-search.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import scopedModelsSelectorHelpers from "./scoped-models-selector-helpers.ts";
import type scopedModelsSelectorInternalTypes from "./scoped-models-selector-internal.types.ts";
import ScopedModelsSelectorComponentLayer0 from "./scoped-models-selector-layer-0.ts";
import ScopedModelsSelectorComponent from "./scoped-models-selector.ts";

const { theme } = themeModule;
const { keyDisplayText } = keybindingHints;
const { Key, Spacer, Text, fuzzyFilter, getKeybindings, matchesKey } = tui;
const { getModelSearchText } = modelSearch;
const { clearAll, enableAll, getSortedIds, isEnabled, move, toggle } = scopedModelsSelectorHelpers;

export default abstract class ScopedModelsSelectorComponentLayer1 extends ScopedModelsSelectorComponentLayer0 {
  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
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

  protected buildItems(): scopedModelsSelectorInternalTypes.ModelItem[] {
    return getSortedIds(this.enabledIds, this.allIds).map((id) => ({
      enabled: isEnabled(this.enabledIds, id),
      fullId: id,
      model: this.modelsById.get(id),
    }));
  }

  protected getFooterText(): string {
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

  protected refresh(): void {
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

  protected notifyChange(): void {
    this.callbacks.onChange(this.enabledIds === null ? null : [...this.enabledIds]);
  }

  protected updateList(): void {
    this.listContainer.clear();

    if (this.filteredItems.length === 0) {
      this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
      return;
    }

    const selected = ScopedModelsSelectorComponent.updateListSelected(
      this as unknown as ScopedModelsSelectorComponent,
    );
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
          this.handleInputPart6(item, delta);
        }
      }
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      return this.handleInputPart2();
    }

    if (kb.matches(data, "app.models.enableAll")) {
      return this.handleInputPart3();
    }

    if (kb.matches(data, "app.models.clearAll")) {
      return this.handleInputPart4();
    }

    if (kb.matches(data, "app.models.toggleProvider")) {
      return this.handleInputPart1();
    }

    if (kb.matches(data, "app.models.save")) {
      this.callbacks.onPersist(this.enabledIds === null ? null : [...this.enabledIds]);
      this.isDirty = false;
      this.footerText.setText(this.getFooterText());
      return;
    }

    if (matchesKey(data, Key.ctrl("c"))) {
      return this.handleInputPart5();
    }

    if (matchesKey(data, Key.escape)) {
      this.callbacks.onCancel();
      return;
    }

    this.searchInput.handleInput(data);
    this.refresh();
  }

  protected handleInputPart6(item: scopedModelsSelectorInternalTypes.ModelItem, delta: number) {
    this.enabledIds = move(this.enabledIds, item.fullId, delta);
    this.isDirty = true;
    this.selectedIndex += delta;
    this.refresh();
    this.notifyChange();
  }

  protected handleInputPart5(): void {
    if (this.searchInput.getValue() === "") {
      this.callbacks.onCancel();
    } else {
      this.searchInput.setValue("");
      this.refresh();
    }
  }

  protected handleInputPart4(): void {
    const targetIds =
      this.searchInput.getValue() === "" ? undefined : this.filteredItems.map((i) => i.fullId);
    this.enabledIds = clearAll(this.enabledIds, this.allIds, targetIds);
    this.isDirty = true;
    this.refresh();
    this.notifyChange();
  }

  protected handleInputPart3(): void {
    const targetIds =
      this.searchInput.getValue() === "" ? undefined : this.filteredItems.map((i) => i.fullId);
    this.enabledIds = enableAll(this.enabledIds, this.allIds, targetIds);
    this.isDirty = true;
    this.refresh();
    this.notifyChange();
  }

  protected handleInputPart2(): void {
    const item = this.filteredItems[this.selectedIndex];
    if (item !== undefined) {
      this.enabledIds = toggle(this.enabledIds, this.allIds, item.fullId);
      this.isDirty = true;
      this.refresh();
      this.notifyChange();
    }
  }

  protected handleInputPart1(): void {
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
  }

  getSearchInput(): tuiTypes.Input {
    return this.searchInput;
  }
}
