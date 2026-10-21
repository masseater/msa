import tui from "@msa/tui";

import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import themeModule from "../../theme/theme.ts";
import treeListHelpers from "../tree-list-helpers.ts";
import type treeListInternalTypes from "../tree-list-internal.types.ts";
import type TreeList from "../tree-list.ts";

const { truncateToWidth, visibleWidth } = tui;
const { renderHorizontalViewport } = treeListHelpers;
const { theme } = themeModule;

export default class TreeRendering {
  private readonly list: TreeList;

  constructor(list: TreeList) {
    this.list = list;
  }

  getStatusLabels(): string {
    let labels = "";
    switch (this.list.filterMode) {
      case "no-tools":
        labels += " [no-tools]";
        break;
      case "user-only":
        labels += " [user]";
        break;
      case "labeled-only":
        labels += " [labeled]";
        break;
      case "all":
        labels += " [all]";
        break;
    }
    if (this.list.showLabelTimestamps) {
      labels += " [+label time]";
    }
    return labels;
  }

  renderEntryLine(
    startIndex: number,
    offset: number,
    flatNode: treeListInternalTypes.FlatNode,
    renderedRows: treeListInternalTypes.HorizontalViewportRow[],
  ) {
    const {
      totalChars,
      prefixChars,
      connector,
      connectorPosition,
      entry,
      isFolded,
      isSelected,
      cursor,
    } = this.prefixLayout(startIndex, offset, flatNode);
    const { prefix, foldMarker, pathMarker, label } = this.renderPrefix(
      totalChars,
      flatNode,
      prefixChars,
      connector,
      connectorPosition,
      entry,
      isFolded,
    );
    this.appendRow(
      flatNode,
      isSelected,
      prefix,
      foldMarker,
      pathMarker,
      cursor,
      label,
      renderedRows,
    );
  }

  prefixLayout(
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
    const isSelected = i === this.list.selectedIndex;

    const cursor = isSelected ? theme.fg("accent", "› ") : "  ";

    const displayIndent = this.list.multipleRoots
      ? Math.max(0, flatNode.indent - 1)
      : flatNode.indent;

    const connector =
      flatNode.showConnector && !flatNode.isVirtualRootChild
        ? flatNode.isLast
          ? "└─ "
          : "├─ "
        : "";
    const connectorPosition = connector === "" ? -1 : displayIndent - 1;

    const totalChars = displayIndent * 3;
    const prefixChars: string[] = [];
    const isFolded = this.list.foldedNodes.has(entry.id);
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

  renderPrefix(
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
          const foldable = this.list.layout.isFoldable(entry.id);
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

    const isOnActivePath = this.list.activePathIds.has(entry.id);
    const pathMarker = isOnActivePath ? theme.fg("accent", "• ") : "";

    const label =
      flatNode.node.label !== undefined && flatNode.node.label !== ""
        ? theme.fg("warning", `[${flatNode.node.label}] `)
        : "";
    return { foldMarker, label, pathMarker, prefix };
  }

  appendRow(
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
      this.list.showLabelTimestamps &&
      flatNode.node.label !== undefined &&
      flatNode.node.label !== "" &&
      flatNode.node.labelTimestamp !== undefined &&
      flatNode.node.labelTimestamp !== ""
        ? theme.fg(
            "muted",
            `${this.list.entryText.formatLabelTimestamp(flatNode.node.labelTimestamp)} `,
          )
        : "";
    const content = this.list.entryText.getEntryDisplayText(flatNode.node, isSelected);
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

  render(width: number): string[] {
    const lines: string[] = [];

    if (this.list.filteredNodes.length === 0) {
      lines.push(truncateToWidth(theme.fg("muted", "  No entries found"), width));
      lines.push(truncateToWidth(theme.fg("muted", `  (0/0)${this.getStatusLabels()}`), width));
      return lines;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.list.selectedIndex - Math.floor(this.list.maxVisibleLines / 2),
        this.list.filteredNodes.length - this.list.maxVisibleLines,
      ),
    );
    const endIndex = Math.min(
      startIndex + this.list.maxVisibleLines,
      this.list.filteredNodes.length,
    );

    const renderedRows: treeListInternalTypes.HorizontalViewportRow[] = [];
    for (const [offset, flatNode] of this.list.filteredNodes
      .slice(startIndex, endIndex)
      .entries()) {
      this.renderEntryLine(startIndex, offset, flatNode, renderedRows);
    }

    lines.push(...renderHorizontalViewport(renderedRows, width));
    lines.push(
      truncateToWidth(
        theme.fg(
          "muted",
          `  (${this.list.selectedIndex + 1}/${this.list.filteredNodes.length})${this.getStatusLabels()}`,
        ),
        width,
      ),
    );

    return lines;
  }
}
