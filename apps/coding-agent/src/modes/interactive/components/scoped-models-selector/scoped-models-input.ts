import tui from "@msa/tui";

import scopedModelsSelectorHelpers from "../scoped-models-selector-helpers.ts";
import type scopedModelsSelectorInternalTypes from "../scoped-models-selector-internal.types.ts";
import type ScopedModelsSelectorComponent from "../scoped-models-selector.ts";

const { Key, getKeybindings, matchesKey } = tui;
const { clearAll, enableAll, isEnabled, move, toggle } = scopedModelsSelectorHelpers;

export default class ScopedModelsInput {
  private readonly selector: ScopedModelsSelectorComponent;

  constructor(selector: ScopedModelsSelectorComponent) {
    this.selector = selector;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    const action = this.actions().find(([matches]) => matches(kb, data));
    if (action !== undefined) {
      action[1](kb.matches(data, "app.models.reorderUp") ? -1 : 1);
      return;
    }
    this.selector.searchInput.handleInput(data);
    this.selector.refresh();
  }

  private actions(): Array<
    [(kb: ReturnType<typeof getKeybindings>, data: string) => boolean, (step: 1 | -1) => void]
  > {
    const binding =
      (...names: Parameters<ReturnType<typeof getKeybindings>["matches"]>[1][]) =>
      (kb: ReturnType<typeof getKeybindings>, data: string) =>
        names.some((name) => kb.matches(data, name));
    return [
      [binding("tui.select.up"), () => this.moveCursor(-1)],
      [binding("tui.select.down"), () => this.moveCursor(1)],
      [binding("app.models.reorderUp", "app.models.reorderDown"), (step) => this.reorder(step)],
      [binding("tui.select.confirm"), () => this.toggleSelected()],
      [binding("app.models.enableAll"), () => this.enableAllVisible()],
      [binding("app.models.clearAll"), () => this.clearAllVisible()],
      [binding("app.models.toggleProvider"), () => this.toggleProvider()],
      [binding("app.models.save"), () => this.save()],
      [(_kb, data) => matchesKey(data, Key.ctrl("c")), () => this.clearSearchOrCancel()],
      [(_kb, data) => matchesKey(data, Key.escape), () => this.selector.callbacks.onCancel()],
    ];
  }

  private moveCursor(step: 1 | -1): void {
    const { selector } = this;
    const count = selector.filteredItems.length;
    if (count === 0) return;
    selector.selectedIndex = (selector.selectedIndex + step + count) % count;
    selector.view.updateList();
  }

  private reorder(step: 1 | -1): void {
    const { selector } = this;
    if (selector.enabledIds === null) return;
    const item = selector.filteredItems[selector.selectedIndex];
    if (item === undefined || !isEnabled(selector.enabledIds, item.fullId)) return;
    const newIndex = selector.enabledIds.indexOf(item.fullId) + step;
    if (newIndex >= 0 && newIndex < selector.enabledIds.length) {
      this.moveSelected(item, step);
    }
  }

  private save(): void {
    const { selector } = this;
    selector.callbacks.onPersist(selector.enabledIds === null ? null : [...selector.enabledIds]);
    selector.isDirty = false;
    selector.footerText.setText(selector.view.getFooterText());
  }

  private moveSelected(item: scopedModelsSelectorInternalTypes.ModelItem, delta: number) {
    this.selector.enabledIds = move(this.selector.enabledIds, item.fullId, delta);
    this.selector.isDirty = true;
    this.selector.selectedIndex += delta;
    this.selector.refresh();
    this.selector.notifyChange();
  }

  private clearSearchOrCancel(): void {
    if (this.selector.searchInput.getValue() === "") {
      this.selector.callbacks.onCancel();
    } else {
      this.selector.searchInput.setValue("");
      this.selector.refresh();
    }
  }

  private clearAllVisible(): void {
    const targetIds =
      this.selector.searchInput.getValue() === ""
        ? undefined
        : this.selector.filteredItems.map((i) => i.fullId);
    this.selector.enabledIds = clearAll(this.selector.enabledIds, this.selector.allIds, targetIds);
    this.selector.isDirty = true;
    this.selector.refresh();
    this.selector.notifyChange();
  }

  private enableAllVisible(): void {
    const targetIds =
      this.selector.searchInput.getValue() === ""
        ? undefined
        : this.selector.filteredItems.map((i) => i.fullId);
    this.selector.enabledIds = enableAll(this.selector.enabledIds, this.selector.allIds, targetIds);
    this.selector.isDirty = true;
    this.selector.refresh();
    this.selector.notifyChange();
  }

  private toggleSelected(): void {
    const item = this.selector.filteredItems[this.selector.selectedIndex];
    if (item !== undefined) {
      this.selector.enabledIds = toggle(
        this.selector.enabledIds,
        this.selector.allIds,
        item.fullId,
      );
      this.selector.isDirty = true;
      this.selector.refresh();
      this.selector.notifyChange();
    }
  }

  private toggleProvider(): void {
    const item = this.selector.filteredItems[this.selector.selectedIndex];
    if (item?.model !== undefined) {
      const provider = item.model.provider;
      const providerIds = this.selector.allIds.filter(
        (id) => this.selector.modelsById.get(id)!.provider === provider,
      );
      const allEnabled = providerIds.every((id) => isEnabled(this.selector.enabledIds, id));
      this.selector.enabledIds = allEnabled
        ? clearAll(this.selector.enabledIds, this.selector.allIds, providerIds)
        : enableAll(this.selector.enabledIds, this.selector.allIds, providerIds);
      this.selector.isDirty = true;
      this.selector.refresh();
      this.selector.notifyChange();
    }
  }
}
