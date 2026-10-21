import tui from "@msa/tui";

import themeModule from "../../theme/theme.ts";
import type resourceListInternalTypes from "../resource-list-internal.types.ts";
import type ResourceList from "../resource-list.ts";

const { theme } = themeModule;
const { truncateToWidth } = tui;

export default class ResourceListView {
  private readonly list: ResourceList;

  constructor(list: ResourceList) {
    this.list = list;
  }

  buildFlatList(): void {
    this.list.flatItems = [];
    for (const group of this.list.groups) {
      this.list.flatItems.push({ group, type: "group" });
      for (const subgroup of group.subgroups) {
        this.list.flatItems.push({ group, subgroup, type: "subgroup" });
        for (const item of subgroup.items) {
          this.list.flatItems.push({ item, type: "item" });
        }
      }
    }
    this.list.selectedIndex = this.list.flatItems.findIndex((e) => e.type === "item");
    if (this.list.selectedIndex < 0) this.list.selectedIndex = 0;
  }

  findNextItem(fromIndex: number, direction: 1 | -1): number {
    let idx = fromIndex + direction;
    while (idx >= 0 && idx < this.list.filteredItems.length) {
      if (this.list.filteredItems[idx]?.type === "item") {
        return idx;
      }
      idx += direction;
    }
    return fromIndex;
  }

  filterItems(query: string): void {
    if (query.trim() === "") {
      this.list.filteredItems = [...this.list.flatItems];
      this.selectFirstItem();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matchingItems = new Set<resourceListInternalTypes.ResourceItem>();
    const matchingSubgroups = new Set<resourceListInternalTypes.ResourceSubgroup>();
    const matchingGroups = new Set<resourceListInternalTypes.ResourceGroup>();

    for (const entry of this.list.flatItems) {
      if (entry.type === "item") {
        const item = entry.item;
        if (
          item.displayName.toLowerCase().includes(lowerQuery) ||
          item.resourceType.toLowerCase().includes(lowerQuery) ||
          item.path.toLowerCase().includes(lowerQuery)
        ) {
          matchingItems.add(item);
        }
      }
    }

    for (const group of this.list.groups) {
      for (const subgroup of group.subgroups) {
        for (const item of subgroup.items) {
          if (matchingItems.has(item)) {
            matchingSubgroups.add(subgroup);
            matchingGroups.add(group);
          }
        }
      }
    }

    this.list.filteredItems = [];
    for (const entry of this.list.flatItems) {
      if (entry.type === "group" && matchingGroups.has(entry.group)) {
        this.list.filteredItems.push(entry);
      } else if (entry.type === "subgroup" && matchingSubgroups.has(entry.subgroup)) {
        this.list.filteredItems.push(entry);
      } else if (entry.type === "item" && matchingItems.has(entry.item)) {
        this.list.filteredItems.push(entry);
      }
    }

    this.selectFirstItem();
  }

  private selectFirstItem(): void {
    const firstItemIndex = this.list.filteredItems.findIndex((e) => e.type === "item");
    this.list.selectedIndex = firstItemIndex >= 0 ? firstItemIndex : 0;
  }

  renderItem(
    entry: { type: "item"; item: resourceListInternalTypes.ResourceItem },
    isSelected: boolean,
    lines: string[],
    width: number,
  ) {
    const item = entry.item;
    const cursor = isSelected ? "> " : "  ";
    const dimmed = this.isDimmedItem(item);
    const nameText = isSelected && !dimmed ? theme.bold(item.displayName) : item.displayName;
    const name = dimmed ? theme.fg("dim", nameText) : nameText;
    lines.push(
      truncateToWidth(
        `${cursor}    ${this.renderCheckbox(item)} ${name}${this.getItemSuffix(item)}`,
        width,
        "...",
      ),
    );
  }

  private renderCheckbox(item: resourceListInternalTypes.ResourceItem): string {
    if (this.list.writeScope === "project") {
      const state = this.list.overrides.getProjectOverrideState(item);
      if (state === "load") return theme.fg("success", "[+]");
      if (state === "unload") return theme.fg("warning", "[-]");
      return theme.fg("dim", item.enabled ? "[x]" : "[ ]");
    }
    return item.enabled ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
  }

  private getItemSuffix(item: resourceListInternalTypes.ResourceItem): string {
    if (this.list.writeScope !== "project") return "";
    const state = this.list.overrides.getProjectOverrideState(item);
    if (state === "load") return theme.fg("muted", "  project load");
    if (state === "unload") return theme.fg("muted", "  project unload");
    return this.list.overrides.isInheritedGlobalItem(item)
      ? theme.fg("dim", "  inherited global")
      : "";
  }

  private isDimmedItem(item: resourceListInternalTypes.ResourceItem): boolean {
    return (
      this.list.writeScope === "project" &&
      this.list.overrides.isInheritedGlobalItem(item) &&
      this.list.overrides.getProjectOverrideState(item) === "inherit"
    );
  }
}
