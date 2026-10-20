import tui from "@msa/tui";

import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import themeModule from "../theme/theme.ts";
import treeListHelpers from "./tree-list-helpers.ts";
import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeListLayer4 from "./tree-list-layer-4.ts";
import TreeList from "./tree-list.ts";

const { getKeybindings, truncateToWidth } = tui;
const { theme } = themeModule;
const { renderHorizontalViewport } = treeListHelpers;

export default abstract class TreeListLayer5 extends TreeListLayer4 {
  protected flattenTree(
    roots: sessionManagerTypes.SessionTreeNode[],
  ): treeListInternalTypes.FlatNode[] {
    const result: treeListInternalTypes.FlatNode[] = [];
    const {
      orderedRoots,
      stack,
      multipleRoots,
      containsActive,
    }: {
      orderedRoots: sessionManagerTypes.SessionTreeNode[];
      stack: [
        sessionManagerTypes.SessionTreeNode,
        number,
        boolean,
        boolean,
        boolean,
        treeListInternalTypes.GutterInfo[],
        boolean,
      ][];
      multipleRoots: boolean;
      containsActive: Map<sessionManagerTypes.SessionTreeNode, boolean>;
    } = this.flattenTreePart2(roots);
    for (let i = orderedRoots.length - 1; i >= 0; i--) {
      const root = orderedRoots[i];
      if (root === undefined) continue;
      this.flattenTreePart4(i, orderedRoots, stack, root, multipleRoots);
    }

    while (stack.length > 0) {
      const [node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] =
        stack.pop()!;

      this.flattenTreePart3(
        node,
        result,
        gutters,
        indent,
        isLast,
        isVirtualRootChild,
        showConnector,
        containsActive,
        justBranched,
        stack,
      );
    }

    return result;
  }

  protected flattenTreePart3(
    node: sessionManagerTypes.SessionTreeNode,
    result: treeListInternalTypes.FlatNode[],
    gutters: treeListInternalTypes.GutterInfo[],
    indent: number,
    isLast: boolean,
    isVirtualRootChild: boolean,
    showConnector: boolean,
    containsActive: Map<sessionManagerTypes.SessionTreeNode, boolean>,
    justBranched: boolean,
    stack: [
      sessionManagerTypes.SessionTreeNode,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][],
  ) {
    let {
      connectorDisplayed,
      orderedChildren,
      childIndent,
      multipleChildren,
    }: ReturnType<TreeList["flattenTreePart1"]> = this.flattenTreePart1(
      node,
      result,
      gutters,
      indent,
      isLast,
      isVirtualRootChild,
      showConnector,
      containsActive,
      justBranched,
    );
    const currentDisplayIndent = this.multipleRoots ? Math.max(0, indent - 1) : indent;
    const connectorPosition = Math.max(0, currentDisplayIndent - 1);
    this.flattenTreePart3Part1(
      connectorDisplayed,
      gutters,
      connectorPosition,
      isLast,
      orderedChildren,
      stack,
      childIndent,
      multipleChildren,
    );
  }

  render(width: number): string[] {
    const lines: string[] = [];

    if (this.filteredNodes.length === 0) {
      lines.push(truncateToWidth(theme.fg("muted", "  No entries found"), width));
      lines.push(truncateToWidth(theme.fg("muted", `  (0/0)${this.getStatusLabels()}`), width));
      return lines;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisibleLines / 2),
        this.filteredNodes.length - this.maxVisibleLines,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisibleLines, this.filteredNodes.length);

    const renderedRows: treeListInternalTypes.HorizontalViewportRow[] = [];
    for (const [offset, flatNode] of this.filteredNodes.slice(startIndex, endIndex).entries()) {
      this.renderPart1(startIndex, offset, flatNode, renderedRows);
    }

    lines.push(...renderHorizontalViewport(renderedRows, width));
    lines.push(
      truncateToWidth(
        theme.fg(
          "muted",
          `  (${this.selectedIndex + 1}/${this.filteredNodes.length})${this.getStatusLabels()}`,
        ),
        width,
      ),
    );

    return lines;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0 ? this.filteredNodes.length - 1 : this.selectedIndex - 1;
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.filteredNodes.length - 1 ? 0 : this.selectedIndex + 1;
    } else if (kb.matches(keyData, "app.tree.foldOrUp")) {
      TreeList.handleInputPart1(this as unknown as TreeList);
    } else if (kb.matches(keyData, "app.tree.unfoldOrDown")) {
      TreeList.handleInputPart2(this as unknown as TreeList);
    } else if (
      kb.matches(keyData, "tui.editor.cursorLeft") ||
      kb.matches(keyData, "tui.select.pageUp")
    ) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisibleLines);
    } else if (
      kb.matches(keyData, "tui.editor.cursorRight") ||
      kb.matches(keyData, "tui.select.pageDown")
    ) {
      this.selectedIndex = Math.min(
        this.filteredNodes.length - 1,
        this.selectedIndex + this.maxVisibleLines,
      );
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selected = this.filteredNodes[this.selectedIndex];
      if (selected !== undefined && this.onSelect !== undefined) {
        this.onSelect(selected.node.entry.id);
      }
    } else if (kb.matches(keyData, "app.message.copy")) {
      this.copySelected();
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      TreeList.handleInputPart3(this as unknown as TreeList);
    } else if (kb.matches(keyData, "app.tree.filter.default")) {
      this.filterMode = "default";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "app.tree.filter.noTools")) {
      this.filterMode = this.filterMode === "no-tools" ? "default" : "no-tools";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "app.tree.filter.userOnly")) {
      this.filterMode = this.filterMode === "user-only" ? "default" : "user-only";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "app.tree.filter.labeledOnly")) {
      this.filterMode = this.filterMode === "labeled-only" ? "default" : "labeled-only";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "app.tree.filter.all")) {
      this.filterMode = this.filterMode === "all" ? "default" : "all";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "app.tree.filter.cycleBackward")) {
      this.handleInputPart5();
    } else if (kb.matches(keyData, "app.tree.filter.cycleForward")) {
      this.handleInputPart6();
    } else if (kb.matches(keyData, "tui.editor.deleteCharBackward")) {
      this.handleInputPart7();
    } else if (kb.matches(keyData, "app.tree.editLabel")) {
      const selected = this.filteredNodes[this.selectedIndex];
      if (selected !== undefined && this.onLabelEdit !== undefined) {
        this.onLabelEdit(selected.node.entry.id, selected.node.label);
      }
    } else if (kb.matches(keyData, "app.tree.toggleLabelTimestamp")) {
      this.showLabelTimestamps = !this.showLabelTimestamps;
    } else {
      TreeList.handleInputPart4(this as unknown as TreeList, keyData);
    }
  }
}
