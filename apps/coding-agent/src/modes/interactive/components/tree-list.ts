import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import themeModule from "../theme/theme.ts";
import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeListLayer6 from "./tree-list-layer-6.ts";
import type treeSelectorTypes from "./tree-selector.types.ts";

const { theme } = themeModule;
const { visibleWidth } = tui;

export default class TreeList extends TreeListLayer6 implements tuiTypes.Component {
  static applyFilterPart1(self: TreeList): void {
    if (self.foldedNodes.size > 0) {
      const skipSet = new Set<string>();
      for (const flatNode of self.flatNodes) {
        const { id, parentId } = flatNode.node.entry;
        if (parentId !== null && (self.foldedNodes.has(parentId) || skipSet.has(parentId))) {
          skipSet.add(id);
        }
      }
      self.filteredNodes = self.filteredNodes.filter(
        (flatNode) => !skipSet.has(flatNode.node.entry.id),
      );
    }

    self.recalculateVisualStructure();

    if (self.lastSelectedId !== null && self.lastSelectedId !== "") {
      self.selectedIndex = self.findNearestVisibleIndex(self.lastSelectedId);
    } else if (self.selectedIndex >= self.filteredNodes.length) {
      self.selectedIndex = Math.max(0, self.filteredNodes.length - 1);
    }

    if (self.filteredNodes.length > 0) {
      self.lastSelectedId =
        self.filteredNodes[self.selectedIndex]?.node.entry.id ?? self.lastSelectedId;
    }
  }

  static recalculateVisualStructureChildren(
    self: TreeList,
    flatNode: treeListInternalTypes.FlatNode,
    indent: number,
    showConnector: boolean,
    isLast: boolean,
    gutters: treeListInternalTypes.GutterInfo[],
    isVirtualRootChild: boolean,
    visibleChildren: Map<string | null, string[]>,
    nodeId: string,
    justBranched: boolean,
  ): {
    children: string[];
    childIndent: number;
    multipleChildren: boolean;
    childGutters: treeListInternalTypes.GutterInfo[];
  } {
    flatNode.indent = indent;
    flatNode.showConnector = showConnector;
    flatNode.isLast = isLast;
    flatNode.gutters = gutters;
    flatNode.isVirtualRootChild = isVirtualRootChild;

    const children = visibleChildren.get(nodeId) || [];
    const multipleChildren = children.length > 1;

    let childIndent: number;
    if (multipleChildren) {
      childIndent = indent + 1;
    } else if (justBranched && indent > 0) {
      childIndent = indent + 1;
    } else {
      childIndent = indent;
    }

    const connectorDisplayed = showConnector && !isVirtualRootChild;
    const currentDisplayIndent = self.multipleRoots ? Math.max(0, indent - 1) : indent;
    const connectorPosition = Math.max(0, currentDisplayIndent - 1);
    const childGutters: treeListInternalTypes.GutterInfo[] = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters;
    return { childGutters, childIndent, children, multipleChildren };
  }

  static renderTotalChars(
    self: TreeList,
    startIndex: number,
    offset: number,
    flatNode: treeListInternalTypes.FlatNode,
  ): {
    totalChars: number;
    prefixChars: string[];
    connector: "" | "└─ " | "├─ ";
    connectorPosition: number;
    entry: sessionManagerTypes.SessionEntry;
    isFolded: boolean;
    isSelected: boolean;
    cursor: string;
  } {
    const i = startIndex + offset;
    const entry = flatNode.node.entry;
    const isSelected = i === self.selectedIndex;

    const cursor = isSelected ? theme.fg("accent", "› ") : "  ";

    const displayIndent = self.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;

    const connector =
      flatNode.showConnector && !flatNode.isVirtualRootChild
        ? flatNode.isLast
          ? "└─ "
          : "├─ "
        : "";
    const connectorPosition = connector === "" ? -1 : displayIndent - 1;

    const totalChars = displayIndent * 3;
    const prefixChars: string[] = [];
    const isFolded = self.foldedNodes.has(entry.id);
    return {
      connector,
      connectorPosition,
      cursor,
      entry,
      isFolded,
      isSelected,
      prefixChars,
      totalChars,
    };
  }

  static renderPrefix(
    self: TreeList,
    totalChars: number,
    flatNode: treeListInternalTypes.FlatNode,
    prefixChars: string[],
    connector: "" | "└─ " | "├─ ",
    connectorPosition: number,
    entry: sessionManagerTypes.SessionEntry,
    isFolded: boolean,
  ): { prefix: string; foldMarker: string; pathMarker: string; label: string } {
    for (let charIndex = 0; charIndex < totalChars; charIndex++) {
      const level = Math.floor(charIndex / 3);
      const posInLevel = charIndex % 3;

      const gutter = flatNode.gutters.find((g) => g.position === level);
      if (gutter !== undefined) {
        if (posInLevel === 0) {
          prefixChars.push(gutter.show ? "│" : " ");
        } else {
          prefixChars.push(" ");
        }
      } else if (connector !== "" && level === connectorPosition) {
        if (posInLevel === 0) {
          prefixChars.push(flatNode.isLast ? "└" : "├");
        } else if (posInLevel === 1) {
          const foldable = self.isFoldable(entry.id);
          prefixChars.push(isFolded ? "⊞" : foldable ? "⊟" : "─");
        } else {
          prefixChars.push(" ");
        }
      } else {
        prefixChars.push(" ");
      }
    }
    const prefix = prefixChars.join("");

    const showsFoldInConnector = flatNode.showConnector && !flatNode.isVirtualRootChild;
    const foldMarker = isFolded && !showsFoldInConnector ? theme.fg("accent", "⊞ ") : "";

    const isOnActivePath = self.activePathIds.has(entry.id);
    const pathMarker = isOnActivePath ? theme.fg("accent", "• ") : "";

    const label =
      flatNode.node.label !== undefined && flatNode.node.label !== ""
        ? theme.fg("warning", `[${flatNode.node.label}] `)
        : "";
    return { foldMarker, label, pathMarker, prefix };
  }

  static renderPart3(
    self: TreeList,
    flatNode: treeListInternalTypes.FlatNode,
    isSelected: boolean,
    prefix: string,
    foldMarker: string,
    pathMarker: string,
    cursor: string,
    label: string,
    renderedRows: treeListInternalTypes.HorizontalViewportRow[],
  ): void {
    const labelTimestamp =
      self.showLabelTimestamps &&
      flatNode.node.label !== undefined &&
      flatNode.node.label !== "" &&
      flatNode.node.labelTimestamp !== undefined &&
      flatNode.node.labelTimestamp !== ""
        ? theme.fg("muted", `${self.formatLabelTimestamp(flatNode.node.labelTimestamp)} `)
        : "";
    const content = self.getEntryDisplayText(flatNode.node, isSelected);
    const prefixPart = theme.fg("dim", prefix) + foldMarker + pathMarker;
    const anchorCol = visibleWidth(prefixPart);
    let gutter = cursor;
    let body = prefixPart + label + labelTimestamp + content;
    if (isSelected) {
      gutter = theme.bg("selectedBg", gutter);
      body = theme.bg("selectedBg", body);
    }
    renderedRows.push({ anchorCol, body, bodyWidth: visibleWidth(body), gutter, isSelected });
  }

  static handleInputPart1(self: TreeList): void {
    const currentId = self.filteredNodes[self.selectedIndex]?.node.entry.id;
    if (
      currentId !== undefined &&
      currentId !== "" &&
      self.isFoldable(currentId) &&
      !self.foldedNodes.has(currentId)
    ) {
      self.foldedNodes.add(currentId);
      self.applyFilter();
    } else {
      self.selectedIndex = self.findBranchSegmentStart("up");
    }
  }

  static handleInputPart2(self: TreeList): void {
    const currentId = self.filteredNodes[self.selectedIndex]?.node.entry.id;
    if (currentId !== undefined && currentId !== "" && self.foldedNodes.has(currentId)) {
      self.foldedNodes.delete(currentId);
      self.applyFilter();
    } else {
      self.selectedIndex = self.findBranchSegmentStart("down");
    }
  }

  static handleInputPart3(self: TreeList): void {
    if (self.searchQuery === "") {
      self.onCancel?.();
    } else {
      self.searchQuery = "";
      self.foldedNodes.clear();
      self.applyFilter();
    }
  }

  static handleInputPart4(self: TreeList, keyData: string): void {
    const hasControlChars = [...keyData].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    });
    if (!hasControlChars && keyData.length > 0) {
      self.searchQuery += keyData;
      self.foldedNodes.clear();
      self.applyFilter();
    }
  }

  constructor(
    tree: sessionManagerTypes.SessionTreeNode[],
    currentLeafId: string | null,
    maxVisibleLines: number,
    initialSelectedId?: string,
    initialFilterMode?: treeSelectorTypes.FilterMode,
  ) {
    super();
    this.currentLeafId = currentLeafId;
    this.maxVisibleLines = maxVisibleLines;
    this.filterMode = initialFilterMode ?? "default";
    this.multipleRoots = tree.length > 1;
    this.flatNodes = this.flattenTree(tree);
    this.buildActivePath();
    this.applyFilter();

    const targetId = initialSelectedId ?? currentLeafId;
    this.selectedIndex = this.findNearestVisibleIndex(targetId);
    this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? null;
  }
}
