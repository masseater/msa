import tui from "@msa/tui";

import type treeListInternalTypes from "../tree-list-internal.types.ts";
import type TreeList from "../tree-list.ts";
import type treeSelectorTypes from "../tree-selector.types.ts";

const { getKeybindings } = tui;

type KeyAction = [Parameters<ReturnType<typeof getKeybindings>["matches"]>[1], () => void];

const FILTER_MODES: treeSelectorTypes.FilterMode[] = [
  "default",
  "no-tools",
  "user-only",
  "labeled-only",
  "all",
];

const isPrintable = (keyData: string): boolean =>
  keyData.length > 0 &&
  ![...keyData].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });

export default class TreeInput {
  private readonly list: TreeList;

  constructor(list: TreeList) {
    this.list = list;
  }

  handle(keyData: string): void {
    const kb = getKeybindings();
    const action = this.keyActions().find(([key]) => kb.matches(keyData, key));
    if (action !== undefined) {
      action[1]();
    } else if (isPrintable(keyData)) {
      this.setSearchQuery(this.list.searchQuery + keyData);
    }
  }

  private keyActions(): KeyAction[] {
    const { list } = this;
    return [
      ["tui.select.up", () => this.moveUp()],
      ["tui.select.down", () => this.moveDown()],
      ["app.tree.foldOrUp", () => this.foldOrJumpUp()],
      ["app.tree.unfoldOrDown", () => this.unfoldOrJumpDown()],
      ["tui.editor.cursorLeft", () => this.pageUp()],
      ["tui.select.pageUp", () => this.pageUp()],
      ["tui.editor.cursorRight", () => this.pageDown()],
      ["tui.select.pageDown", () => this.pageDown()],
      ["tui.select.confirm", () => this.withSelected((node) => list.onSelect?.(node.entry.id))],
      ["app.message.copy", () => list.copySelected()],
      ["tui.select.cancel", () => this.clearSearchOrCancel()],
      ["app.tree.filter.default", () => this.setFilterMode("default")],
      ["app.tree.filter.noTools", () => this.toggleFilterMode("no-tools")],
      ["app.tree.filter.userOnly", () => this.toggleFilterMode("user-only")],
      ["app.tree.filter.labeledOnly", () => this.toggleFilterMode("labeled-only")],
      ["app.tree.filter.all", () => this.toggleFilterMode("all")],
      ["app.tree.filter.cycleBackward", () => this.cycleFilter(-1)],
      ["app.tree.filter.cycleForward", () => this.cycleFilter(1)],
      ["tui.editor.deleteCharBackward", () => this.setSearchQuery(list.searchQuery.slice(0, -1))],
      [
        "app.tree.editLabel",
        () => this.withSelected((node) => list.onLabelEdit?.(node.entry.id, node.label)),
      ],
      [
        "app.tree.toggleLabelTimestamp",
        () => (list.showLabelTimestamps = !list.showLabelTimestamps),
      ],
    ];
  }

  private moveUp(): void {
    const { list } = this;
    list.selectedIndex =
      list.selectedIndex === 0 ? list.filteredNodes.length - 1 : list.selectedIndex - 1;
  }

  private moveDown(): void {
    const { list } = this;
    list.selectedIndex =
      list.selectedIndex === list.filteredNodes.length - 1 ? 0 : list.selectedIndex + 1;
  }

  private pageUp(): void {
    const { list } = this;
    list.selectedIndex = Math.max(0, list.selectedIndex - list.maxVisibleLines);
  }

  private pageDown(): void {
    const { list } = this;
    list.selectedIndex = Math.min(
      list.filteredNodes.length - 1,
      list.selectedIndex + list.maxVisibleLines,
    );
  }

  private withSelected(action: (node: treeListInternalTypes.FlatNode["node"]) => void): void {
    const selected = this.list.filteredNodes[this.list.selectedIndex];
    if (selected !== undefined) action(selected.node);
  }

  private setFilterMode(mode: treeSelectorTypes.FilterMode): void {
    this.list.filterMode = mode;
    this.list.foldedNodes.clear();
    this.list.filter.applyFilter();
  }

  private toggleFilterMode(mode: treeSelectorTypes.FilterMode): void {
    this.setFilterMode(this.list.filterMode === mode ? "default" : mode);
  }

  private cycleFilter(step: number): void {
    const currentIndex = FILTER_MODES.indexOf(this.list.filterMode);
    const nextIndex = (currentIndex + step + FILTER_MODES.length) % FILTER_MODES.length;
    this.setFilterMode(FILTER_MODES[nextIndex] ?? "default");
  }

  private setSearchQuery(query: string): void {
    if (query === this.list.searchQuery) return;
    this.list.searchQuery = query;
    this.list.foldedNodes.clear();
    this.list.filter.applyFilter();
  }

  private foldOrJumpUp(): void {
    const { list } = this;
    const currentId = list.filteredNodes[list.selectedIndex]?.node.entry.id;
    if (
      currentId !== undefined &&
      currentId !== "" &&
      list.layout.isFoldable(currentId) &&
      !list.foldedNodes.has(currentId)
    ) {
      list.foldedNodes.add(currentId);
      list.filter.applyFilter();
    } else {
      list.selectedIndex = list.layout.findBranchSegmentStart("up");
    }
  }

  private unfoldOrJumpDown(): void {
    const { list } = this;
    const currentId = list.filteredNodes[list.selectedIndex]?.node.entry.id;
    if (currentId !== undefined && currentId !== "" && list.foldedNodes.has(currentId)) {
      list.foldedNodes.delete(currentId);
      list.filter.applyFilter();
    } else {
      list.selectedIndex = list.layout.findBranchSegmentStart("down");
    }
  }

  private clearSearchOrCancel(): void {
    if (this.list.searchQuery === "") {
      this.list.onCancel?.();
    } else {
      this.list.searchQuery = "";
      this.list.foldedNodes.clear();
      this.list.filter.applyFilter();
    }
  }
}
