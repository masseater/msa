import tui from "@msa/tui";

import type resourceListInternalTypes from "./resource-list-internal.types.ts";
import ResourceListLayer2 from "./resource-list-layer-2.ts";

const { getKeybindings, matchesKey } = tui;

export default abstract class ResourceListLayer3 extends ResourceListLayer2 {
  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex = this.findNextItem(this.selectedIndex, -1);
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex = this.findNextItem(this.selectedIndex, 1);
      return;
    }
    if (kb.matches(data, "tui.select.pageUp")) {
      let target = Math.max(0, this.selectedIndex - this.maxVisible);
      while (target < this.filteredItems.length && this.filteredItems[target]?.type !== "item") {
        target++;
      }
      if (target < this.filteredItems.length) {
        this.selectedIndex = target;
      }
      return;
    }
    if (kb.matches(data, "tui.select.pageDown")) {
      let target = Math.min(this.filteredItems.length - 1, this.selectedIndex + this.maxVisible);
      while (target >= 0 && this.filteredItems[target]?.type !== "item") {
        target--;
      }
      if (target >= 0) {
        this.selectedIndex = target;
      }
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, "ctrl+c")) {
      this.onExit?.();
      return;
    }
    if (kb.matches(data, "tui.input.tab")) {
      this.onSwitchMode?.();
      return;
    }
    if (data === " " || kb.matches(data, "tui.select.confirm")) {
      return this.handleInputPart1();
    }

    this.searchInput.handleInput(data);
    this.filterItems(this.searchInput.getValue());
  }

  protected handleInputPart1(): void {
    const entry = this.filteredItems[this.selectedIndex];
    if (
      entry?.type === "item" &&
      (this.writeScope === "project" || this.getItemScope(entry.item) === "user")
    ) {
      const newEnabled = this.toggleResource(entry.item);
      if (newEnabled !== undefined) {
        this.updateItem(entry.item, newEnabled);
        this.onToggle?.(entry.item, newEnabled);
      }
    }
  }

  protected toggleResource(item: resourceListInternalTypes.ResourceItem): boolean | undefined {
    if (this.writeScope === "project") {
      const state = this.getNextOverrideState(item);
      if (!this.setProjectResourceOverride(item, state)) return undefined;
      return state === "inherit" ? this.getInheritedEnabled(item) : state === "load";
    }

    const enabled = !item.enabled;
    if (item.metadata.origin === "top-level") {
      this.toggleTopLevelResource(item, enabled);
    } else {
      this.togglePackageResource(item, enabled);
    }
    return enabled;
  }
}
