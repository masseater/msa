import {
  type Component,
  Container,
  type Focusable,
  getKeybindings,
  Input,
  type Keybinding,
  Spacer,
  sliceByColumn,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@msa/tui";

import { nowIso, nowMs, schedule, toDate } from "../../../core/platform.ts";
import type { SessionTreeNode, SessionEntry } from "../../../core/session-manager.ts";
import { formatReadLineRange, shortenPath } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { formatKeyText, keyHint } from "./keybinding-hints.ts";

interface GutterInfo {
  position: number;
  show: boolean;
}

interface FlatNode {
  node: SessionTreeNode;
  indent: number;
  showConnector: boolean;
  isLast: boolean;
  gutters: GutterInfo[];
  isVirtualRootChild: boolean;
}

interface HorizontalViewportRow {
  gutter: string;
  body: string;
  anchorCol: number;
  bodyWidth: number;
  isSelected: boolean;
}

const TREE_GUTTER_WIDTH = 2;
const MIN_VISIBLE_ANCHOR_CONTENT_WIDTH = 4;
const MAX_VISIBLE_ANCHOR_CONTENT_WIDTH = 20;
const MIN_ANCHOR_CONTEXT_WIDTH = 2;
const MAX_ANCHOR_CONTEXT_WIDTH = 12;

function renderHorizontalViewport(rows: HorizontalViewportRow[], width: number): string[] {
  const viewportWidth = Math.max(0, width - TREE_GUTTER_WIDTH);
  const maxBodyWidth = rows.reduce((max, row) => Math.max(max, row.bodyWidth), 0);
  const maxHorizontalScroll = Math.max(0, maxBodyWidth - viewportWidth);
  const selectedRow = rows.find((row) => row.isSelected);

  let horizontalScroll = 0;
  if (selectedRow !== undefined && maxHorizontalScroll > 0) {
    const minVisibleAnchorContentWidth = Math.min(
      MAX_VISIBLE_ANCHOR_CONTENT_WIDTH,
      Math.max(MIN_VISIBLE_ANCHOR_CONTENT_WIDTH, Math.floor(viewportWidth / 3)),
    );
    if (selectedRow.anchorCol > viewportWidth - minVisibleAnchorContentWidth) {
      const anchorContextWidth = Math.min(
        MAX_ANCHOR_CONTEXT_WIDTH,
        Math.max(MIN_ANCHOR_CONTEXT_WIDTH, Math.floor(viewportWidth / 4)),
      );
      horizontalScroll = Math.min(maxHorizontalScroll, selectedRow.anchorCol - anchorContextWidth);
    }
  }

  return rows.map((row) => {
    const line =
      horizontalScroll > 0
        ? `${row.gutter}${sliceByColumn(row.body, horizontalScroll, viewportWidth, true)}\x1b[0m`
        : row.gutter + row.body;
    return truncateToWidth(line, width, "");
  });
}

export type FilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
}

class TreeList implements Component {
  private flatNodes: FlatNode[] = [];
  private filteredNodes: FlatNode[] = [];
  private selectedIndex = 0;
  private currentLeafId: string | null;
  private maxVisibleLines: number;
  private filterMode: FilterMode = "default";
  private searchQuery = "";
  private toolCallMap: Map<string, ToolCallInfo> = new Map();
  private multipleRoots = false;
  private showLabelTimestamps = false;
  private activePathIds: Set<string> = new Set();
  private visibleParentMap: Map<string, string | null> = new Map();
  private visibleChildrenMap: Map<string | null, string[]> = new Map();
  private lastSelectedId: string | null = null;
  private foldedNodes: Set<string> = new Set();

  public onSelect?: (entryId: string) => void;
  public onCancel?: () => void;
  public onCopy?: (text: string | undefined) => void;
  public onLabelEdit?: (entryId: string, currentLabel: string | undefined) => void;

  constructor(
    tree: SessionTreeNode[],
    currentLeafId: string | null,
    maxVisibleLines: number,
    initialSelectedId?: string,
    initialFilterMode?: FilterMode,
  ) {
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

  private findNearestVisibleIndex(entryId: string | null): number {
    if (this.filteredNodes.length === 0) return 0;

    const entryMap = new Map<string, FlatNode>();
    for (const flatNode of this.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    const visibleIdToIndex = new Map<string, number>(
      this.filteredNodes.map((node, i) => [node.node.entry.id, i]),
    );

    let currentId = entryId;
    while (currentId !== null) {
      const index = visibleIdToIndex.get(currentId);
      if (index !== undefined) return index;
      const node = entryMap.get(currentId);
      if (node === undefined) break;
      currentId = node.node.entry.parentId ?? null;
    }

    return this.filteredNodes.length - 1;
  }

  private buildActivePath(): void {
    this.activePathIds.clear();
    if (this.currentLeafId === null || this.currentLeafId === "") return;

    const entryMap = new Map<string, FlatNode>();
    for (const flatNode of this.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    let currentId: string | null = this.currentLeafId;
    while (currentId !== null && currentId !== "") {
      this.activePathIds.add(currentId);
      const node = entryMap.get(currentId);
      if (node === undefined) break;
      currentId = node.node.entry.parentId ?? null;
    }
  }

  private flattenTree(roots: SessionTreeNode[]): FlatNode[] {
    const result: FlatNode[] = [];
    this.toolCallMap.clear();

    type StackItem = [SessionTreeNode, number, boolean, boolean, boolean, GutterInfo[], boolean];
    const stack: StackItem[] = [];

    const containsActive = new Map<SessionTreeNode, boolean>();
    const leafId = this.currentLeafId;
    {
      const allNodes: SessionTreeNode[] = [];
      const preOrderStack: SessionTreeNode[] = [...roots];
      while (preOrderStack.length > 0) {
        const node = preOrderStack.pop()!;
        allNodes.push(node);
        preOrderStack.push(...node.children.toReversed());
      }
      for (const node of allNodes.toReversed()) {
        let has = leafId !== null && node.entry.id === leafId;
        for (const child of node.children) {
          if (containsActive.get(child) === true) {
            has = true;
          }
        }
        containsActive.set(node, has);
      }
    }

    const multipleRoots = roots.length > 1;
    const orderedRoots = [...roots].sort(
      (a, b) => Number(containsActive.get(b)) - Number(containsActive.get(a)),
    );
    for (let i = orderedRoots.length - 1; i >= 0; i--) {
      const root = orderedRoots[i];
      if (root === undefined) continue;
      const isLast = i === orderedRoots.length - 1;
      stack.push([
        root,
        multipleRoots ? 1 : 0,
        multipleRoots,
        multipleRoots,
        isLast,
        [],
        multipleRoots,
      ]);
    }

    while (stack.length > 0) {
      const [node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] =
        stack.pop()!;

      const entry = node.entry;
      if (entry.type === "message" && entry.message.role === "assistant") {
        const content = (entry.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              typeof block === "object" &&
              block !== null &&
              "type" in block &&
              block.type === "toolCall"
            ) {
              const tc = block as { id: string; name: string; arguments: Record<string, unknown> };
              this.toolCallMap.set(tc.id, { name: tc.name, arguments: tc.arguments });
            }
          }
        }
      }

      result.push({ node, indent, showConnector, isLast, gutters, isVirtualRootChild });

      const children = node.children;
      const multipleChildren = children.length > 1;

      const orderedChildren = (() => {
        const prioritized: SessionTreeNode[] = [];
        const rest: SessionTreeNode[] = [];
        for (const child of children) {
          if (containsActive.get(child) === true) {
            prioritized.push(child);
          } else {
            rest.push(child);
          }
        }
        return [...prioritized, ...rest];
      })();

      let childIndent: number;
      if (multipleChildren) {
        childIndent = indent + 1;
      } else if (justBranched && indent > 0) {
        childIndent = indent + 1;
      } else {
        childIndent = indent;
      }

      const connectorDisplayed = showConnector && !isVirtualRootChild;
      const currentDisplayIndent = this.multipleRoots ? Math.max(0, indent - 1) : indent;
      const connectorPosition = Math.max(0, currentDisplayIndent - 1);
      const childGutters: GutterInfo[] = connectorDisplayed
        ? [...gutters, { position: connectorPosition, show: !isLast }]
        : gutters;

      for (let i = orderedChildren.length - 1; i >= 0; i--) {
        const child = orderedChildren[i];
        if (child === undefined) continue;
        const childIsLast = i === orderedChildren.length - 1;
        stack.push([
          child,
          childIndent,
          multipleChildren,
          multipleChildren,
          childIsLast,
          childGutters,
          false,
        ]);
      }
    }

    return result;
  }

  private applyFilter(): void {
    if (this.filteredNodes.length > 0) {
      this.lastSelectedId =
        this.filteredNodes[this.selectedIndex]?.node.entry.id ?? this.lastSelectedId;
    }

    const searchTokens = this.searchQuery.toLowerCase().split(/\s+/u).filter(Boolean);

    this.filteredNodes = this.flatNodes.filter((flatNode) => {
      const entry = flatNode.node.entry;
      if (entry.type === "usage") return false;
      const isCurrentLeaf = entry.id === this.currentLeafId;

      if (entry.type === "message" && entry.message.role === "assistant" && !isCurrentLeaf) {
        const msg = entry.message as { stopReason?: string; content?: unknown };
        const hasText = this.hasTextContent(msg.content);
        const isErrorOrAborted =
          msg.stopReason && msg.stopReason !== "stop" && msg.stopReason !== "toolUse";
        if (
          !hasText &&
          (isErrorOrAborted === undefined || isErrorOrAborted === "" || isErrorOrAborted === false)
        ) {
          return false;
        }
      }

      let passesFilter: boolean;
      const isSettingsEntry =
        entry.type === "label" ||
        entry.type === "context_edit" ||
        entry.type === "custom" ||
        entry.type === "model_change" ||
        entry.type === "thinking_level_change" ||
        entry.type === "session_info";

      switch (this.filterMode) {
        case "user-only":
          passesFilter = entry.type === "message" && entry.message.role === "user";
          break;
        case "no-tools":
          passesFilter =
            !isSettingsEntry && !(entry.type === "message" && entry.message.role === "toolResult");
          break;
        case "labeled-only":
          passesFilter = flatNode.node.label !== undefined;
          break;
        case "all":
          passesFilter = true;
          break;
        default:
          passesFilter = !isSettingsEntry;
          break;
      }

      if (!passesFilter) return false;

      if (searchTokens.length > 0) {
        const nodeText = this.getSearchableText(flatNode.node).toLowerCase();
        return searchTokens.every((token) => nodeText.includes(token));
      }

      return true;
    });

    TreeList.applyFilterPart1(this);
  }

  private static applyFilterPart1(self: TreeList): void {
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

  private recalculateVisualStructure(): void {
    if (this.filteredNodes.length === 0) return;

    const visibleIds = new Set(this.filteredNodes.map((n) => n.node.entry.id));

    const entryMap = new Map<string, FlatNode>();
    for (const flatNode of this.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    const findVisibleAncestor = (nodeId: string): string | null => {
      let currentId = entryMap.get(nodeId)?.node.entry.parentId ?? null;
      while (currentId !== null) {
        if (visibleIds.has(currentId)) {
          return currentId;
        }
        currentId = entryMap.get(currentId)?.node.entry.parentId ?? null;
      }
      return null;
    };

    const visibleParent = new Map<string, string | null>();
    const visibleChildren = new Map<string | null, string[]>();
    visibleChildren.set(null, []);

    for (const flatNode of this.filteredNodes) {
      const nodeId = flatNode.node.entry.id;
      const ancestorId = findVisibleAncestor(nodeId);
      visibleParent.set(nodeId, ancestorId);

      if (!visibleChildren.has(ancestorId)) {
        visibleChildren.set(ancestorId, []);
      }
      visibleChildren.get(ancestorId)!.push(nodeId);
    }

    const visibleRootIds = visibleChildren.get(null)!;
    this.multipleRoots = visibleRootIds.length > 1;

    const filteredNodeMap = new Map<string, FlatNode>();
    for (const flatNode of this.filteredNodes) {
      filteredNodeMap.set(flatNode.node.entry.id, flatNode);
    }

    type StackItem = [string, number, boolean, boolean, boolean, GutterInfo[], boolean];
    const stack: StackItem[] = [];

    for (let i = visibleRootIds.length - 1; i >= 0; i--) {
      const rootId = visibleRootIds[i];
      if (rootId === undefined) continue;
      const isLast = i === visibleRootIds.length - 1;
      stack.push([
        rootId,
        this.multipleRoots ? 1 : 0,
        this.multipleRoots,
        this.multipleRoots,
        isLast,
        [],
        this.multipleRoots,
      ]);
    }

    while (stack.length > 0) {
      const [nodeId, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] =
        stack.pop()!;

      const flatNode = filteredNodeMap.get(nodeId);
      if (flatNode === undefined) continue;

      let { children, childIndent, multipleChildren, childGutters } =
        TreeList.recalculateVisualStructureChildren(
          this,
          flatNode,
          indent,
          showConnector,
          isLast,
          gutters,
          isVirtualRootChild,
          visibleChildren,
          nodeId,
          justBranched,
        );

      for (let i = children.length - 1; i >= 0; i--) {
        const childId = children[i];
        if (childId === undefined) continue;
        const childIsLast = i === children.length - 1;
        stack.push([
          childId,
          childIndent,
          multipleChildren,
          multipleChildren,
          childIsLast,
          childGutters,
          false,
        ]);
      }
    }

    this.visibleParentMap = visibleParent;
    this.visibleChildrenMap = visibleChildren;
  }

  private static recalculateVisualStructureChildren(
    self: TreeList,
    flatNode: FlatNode,
    indent: number,
    showConnector: boolean,
    isLast: boolean,
    gutters: GutterInfo[],
    isVirtualRootChild: boolean,
    visibleChildren: Map<string | null, string[]>,
    nodeId: string,
    justBranched: boolean,
  ): {
    children: string[];
    childIndent: number;
    multipleChildren: boolean;
    childGutters: GutterInfo[];
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
    const childGutters: GutterInfo[] = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters;
    return { children, childIndent, multipleChildren, childGutters };
  }

  private getSearchableText(node: SessionTreeNode): string {
    const entry = node.entry;
    const parts: string[] = [];

    if (node.label !== undefined && node.label !== "") {
      parts.push(node.label);
    }

    switch (entry.type) {
      case "message": {
        const msg = entry.message;
        parts.push(msg.role);
        if ("content" in msg && msg.content !== "") {
          parts.push(this.extractContent(msg.content));
        }
        if (msg.role === "bashExecution") {
          const bashMsg = msg as { command?: string };
          if (bashMsg.command !== undefined && bashMsg.command !== "") parts.push(bashMsg.command);
        }
        break;
      }
      case "custom_message": {
        parts.push(entry.customType);
        if (typeof entry.content === "string") {
          parts.push(entry.content);
        } else {
          parts.push(this.extractContent(entry.content));
        }
        break;
      }
      case "compaction":
        parts.push("compaction");
        break;
      case "branch_summary":
        parts.push("branch summary", entry.summary);
        break;
      case "session_info":
        parts.push("title");
        if (entry.name !== undefined && entry.name !== "") parts.push(entry.name);
        break;
      case "model_change":
        parts.push("model", entry.modelId);
        break;
      case "thinking_level_change":
        parts.push("thinking", entry.thinkingLevel);
        break;
      case "custom":
        parts.push("custom", entry.customType);
        break;
      case "context_edit":
        parts.push("context edit", entry.replacement === null ? "omit" : "replace", entry.targetId);
        break;
      case "label":
        parts.push("label", entry.label ?? "");
        break;
    }

    return parts.join(" ");
  }

  invalidate(): void {}

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getSelectedNode(): SessionTreeNode | undefined {
    return this.filteredNodes[this.selectedIndex]?.node;
  }

  copySelected(): void {
    const node = this.getSelectedNode();
    this.onCopy?.(node === undefined ? undefined : this.getEntryCopyText(node));
  }

  updateNodeLabel(entryId: string, label: string | undefined, labelTimestamp?: string): void {
    for (const flatNode of this.flatNodes) {
      if (flatNode.node.entry.id === entryId) {
        flatNode.node.label = label;
        flatNode.node.labelTimestamp =
          label !== undefined && label !== "" ? (labelTimestamp ?? nowIso()) : undefined;
        break;
      }
    }
  }

  private getStatusLabels(): string {
    let labels = "";
    switch (this.filterMode) {
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
    if (this.showLabelTimestamps) {
      labels += " [+label time]";
    }
    return labels;
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

    const renderedRows: HorizontalViewportRow[] = [];
    for (const [offset, flatNode] of this.filteredNodes.slice(startIndex, endIndex).entries()) {
      const {
        totalChars,
        prefixChars,
        connector,
        connectorPosition,
        entry,
        isFolded,
        isSelected,
        cursor,
      } = TreeList.renderTotalChars(this, startIndex, offset, flatNode);
      const { prefix, foldMarker, pathMarker, label } = TreeList.renderPrefix(
        this,
        totalChars,
        flatNode,
        prefixChars,
        connector,
        connectorPosition,
        entry,
        isFolded,
      );
      TreeList.renderPart3(
        this,
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

  private static renderTotalChars(
    self: TreeList,
    startIndex: number,
    offset: number,
    flatNode: FlatNode,
  ): {
    totalChars: number;
    prefixChars: string[];
    connector: "" | "└─ " | "├─ ";
    connectorPosition: number;
    entry: SessionEntry;
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
      totalChars,
      prefixChars,
      connector,
      connectorPosition,
      entry,
      isFolded,
      isSelected,
      cursor,
    };
  }

  private static renderPrefix(
    self: TreeList,
    totalChars: number,
    flatNode: FlatNode,
    prefixChars: string[],
    connector: "" | "└─ " | "├─ ",
    connectorPosition: number,
    entry: SessionEntry,
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
    return { prefix, foldMarker, pathMarker, label };
  }

  private static renderPart3(
    self: TreeList,
    flatNode: FlatNode,
    isSelected: boolean,
    prefix: string,
    foldMarker: string,
    pathMarker: string,
    cursor: string,
    label: string,
    renderedRows: HorizontalViewportRow[],
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
    renderedRows.push({ gutter, body, anchorCol, bodyWidth: visibleWidth(body), isSelected });
  }

  private getEntryDisplayText(node: SessionTreeNode, isSelected: boolean): string {
    const entry = node.entry;
    let result: string;

    const normalize = (s: string) => s.replace(/[\n\t]/gu, " ").trim();

    switch (entry.type) {
      case "message": {
        const msg = entry.message;
        const role = msg.role;
        if (role === "user") {
          const msgWithContent = msg as { content?: unknown };
          const content = normalize(this.extractContent(msgWithContent.content));
          result = theme.fg("accent", "user: ") + content;
        } else if (role === "assistant") {
          const msgWithContent = msg as {
            content?: unknown;
            stopReason?: string;
            errorMessage?: string;
          };
          const textContent = normalize(this.extractContent(msgWithContent.content));
          if (textContent !== "") {
            result = theme.fg("success", "assistant: ") + textContent;
          } else if (msgWithContent.stopReason === "aborted") {
            result = theme.fg("success", "assistant: ") + theme.fg("muted", "(aborted)");
          } else if (
            msgWithContent.errorMessage !== undefined &&
            msgWithContent.errorMessage !== ""
          ) {
            const errMsg = normalize(msgWithContent.errorMessage).slice(0, 80);
            result = theme.fg("success", "assistant: ") + theme.fg("error", errMsg);
          } else {
            result = theme.fg("success", "assistant: ") + theme.fg("muted", "(no content)");
          }
        } else if (role === "toolResult") {
          const toolMsg = msg as { toolCallId?: string; toolName?: string };
          const toolCall =
            toolMsg.toolCallId !== undefined && toolMsg.toolCallId !== ""
              ? this.toolCallMap.get(toolMsg.toolCallId)
              : undefined;
          if (toolCall === undefined) {
            result = theme.fg("muted", `[${toolMsg.toolName ?? "tool"}]`);
          } else {
            result = theme.fg("muted", this.formatToolCall(toolCall.name, toolCall.arguments));
          }
        } else if (role === "bashExecution") {
          const bashMsg = msg as { command?: string };
          result = theme.fg("dim", `[bash]: ${normalize(bashMsg.command ?? "")}`);
        } else {
          result = theme.fg("dim", `[${role}]`);
        }
        break;
      }
      case "custom_message": {
        const content =
          typeof entry.content === "string"
            ? entry.content
            : entry.content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("");
        result = theme.fg("customMessageLabel", `[${entry.customType}]: `) + normalize(content);
        break;
      }
      case "compaction": {
        const tokens = Math.round(entry.tokensBefore / 1000);
        result = theme.fg("borderAccent", `[compaction: ${tokens}k tokens]`);
        break;
      }
      case "branch_summary":
        result = theme.fg("warning", `[branch summary]: `) + normalize(entry.summary);
        break;
      case "model_change":
        result = theme.fg("dim", `[model: ${entry.modelId}]`);
        break;
      case "thinking_level_change":
        result = theme.fg("dim", `[thinking: ${entry.thinkingLevel}]`);
        break;
      case "custom":
        result = theme.fg("dim", `[custom: ${entry.customType}]`);
        break;
      case "context_edit":
        result = theme.fg(
          "dim",
          `[context ${entry.replacement === null ? "omit" : "replace"}: ${entry.targetId}]`,
        );
        break;
      case "label":
        result = theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`);
        break;
      case "session_info":
        result =
          entry.name !== undefined && entry.name !== ""
            ? [theme.fg("dim", "[title: "), theme.fg("dim", entry.name), theme.fg("dim", "]")].join(
                "",
              )
            : [
                theme.fg("dim", "[title: "),
                theme.italic(theme.fg("dim", "empty")),
                theme.fg("dim", "]"),
              ].join("");
        break;
      default:
        result = "";
    }

    return isSelected ? theme.bold(result) : result;
  }

  private formatLabelTimestamp(timestamp: string): string {
    const date = toDate(timestamp);
    const now = toDate(nowMs());
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const time = `${hours}:${minutes}`;

    if (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    ) {
      return time;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    if (date.getFullYear() === now.getFullYear()) {
      return `${month}/${day} ${time}`;
    }

    const year = date.getFullYear().toString().slice(-2);
    return `${year}/${month}/${day} ${time}`;
  }

  private extractContent(content: unknown): string {
    return this.extractFullContent(content).slice(0, 200);
  }

  private extractFullContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    let result = "";
    for (const block of content) {
      if (typeof block === "object" && block !== null && "type" in block && block.type === "text") {
        result += (block as { text: string }).text;
      }
    }
    return result;
  }

  private getEntryCopyText(node: SessionTreeNode): string | undefined {
    const entry = node.entry;
    let text: string | undefined;

    switch (entry.type) {
      case "message":
        if (entry.message.role === "bashExecution") {
          text = entry.message.command;
        } else if ("content" in entry.message) {
          text = this.extractFullContent(entry.message.content);
          if (text === "" && entry.message.role === "assistant") {
            text = entry.message.errorMessage;
          }
        }
        break;
      case "custom_message":
        text = this.extractFullContent(entry.content);
        break;
      case "compaction":
        text = entry.summary;
        break;
      case "branch_summary":
        text = entry.summary;
        break;
    }

    return (text?.trim() ?? "") === "" ? undefined : text;
  }

  private hasTextContent(content: unknown): boolean {
    if (typeof content === "string") return content.trim().length > 0;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === "object" && c !== null && "type" in c && c.type === "text") {
          const text = (c as { text?: string }).text;
          if (text !== undefined && text !== "" && text.trim().length > 0) return true;
        }
      }
    }
    return false;
  }

  private formatToolCall(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case "read": {
        const path = shortenPath(String(args["path"] || args["file_path"] || ""));
        return `[read: ${path}${formatReadLineRange(args["offset"], args["limit"])}]`;
      }
      case "write": {
        const path = shortenPath(String(args["path"] || args["file_path"] || ""));
        return `[write: ${path}]`;
      }
      case "edit": {
        const path = shortenPath(String(args["path"] || args["file_path"] || ""));
        return `[edit: ${path}]`;
      }
      case "bash": {
        const rawCmd = String(args["command"] || "");
        const cmd = rawCmd
          .replace(/[\n\t]/gu, " ")
          .trim()
          .slice(0, 50);
        return `[bash: ${cmd}${rawCmd.length > 50 ? "..." : ""}]`;
      }
      case "grep": {
        const pattern = String(args["pattern"] || "");
        const path = shortenPath(String(args["path"] || "."));
        return `[grep: /${pattern}/ in ${path}]`;
      }
      case "find": {
        const pattern = String(args["pattern"] || "");
        const path = shortenPath(String(args["path"] || "."));
        return `[find: ${pattern} in ${path}]`;
      }
      case "ls": {
        const path = shortenPath(String(args["path"] || "."));
        return `[ls: ${path}]`;
      }
      default: {
        const argsStr = JSON.stringify(args).slice(0, 40);
        return `[${name}: ${argsStr}${JSON.stringify(args).length > 40 ? "..." : ""}]`;
      }
    }
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
      TreeList.handleInputPart1(this);
    } else if (kb.matches(keyData, "app.tree.unfoldOrDown")) {
      TreeList.handleInputPart2(this);
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
      TreeList.handleInputPart3(this);
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
      const modes: FilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
      const currentIndex = modes.indexOf(this.filterMode);
      this.filterMode = modes[(currentIndex - 1 + modes.length) % modes.length] ?? "default";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "app.tree.filter.cycleForward")) {
      const modes: FilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
      const currentIndex = modes.indexOf(this.filterMode);
      this.filterMode = modes[(currentIndex + 1) % modes.length] ?? "default";
      this.foldedNodes.clear();
      this.applyFilter();
    } else if (kb.matches(keyData, "tui.editor.deleteCharBackward")) {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.foldedNodes.clear();
        this.applyFilter();
      }
    } else if (kb.matches(keyData, "app.tree.editLabel")) {
      const selected = this.filteredNodes[this.selectedIndex];
      if (selected !== undefined && this.onLabelEdit !== undefined) {
        this.onLabelEdit(selected.node.entry.id, selected.node.label);
      }
    } else if (kb.matches(keyData, "app.tree.toggleLabelTimestamp")) {
      this.showLabelTimestamps = !this.showLabelTimestamps;
    } else {
      TreeList.handleInputPart4(this, keyData);
    }
  }

  private static handleInputPart1(self: TreeList): void {
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

  private static handleInputPart2(self: TreeList): void {
    const currentId = self.filteredNodes[self.selectedIndex]?.node.entry.id;
    if (currentId !== undefined && currentId !== "" && self.foldedNodes.has(currentId)) {
      self.foldedNodes.delete(currentId);
      self.applyFilter();
    } else {
      self.selectedIndex = self.findBranchSegmentStart("down");
    }
  }

  private static handleInputPart3(self: TreeList): void {
    if (self.searchQuery === "") {
      self.onCancel?.();
    } else {
      self.searchQuery = "";
      self.foldedNodes.clear();
      self.applyFilter();
    }
  }

  private static handleInputPart4(self: TreeList, keyData: string): void {
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

  private isFoldable(entryId: string): boolean {
    const children = this.visibleChildrenMap.get(entryId);
    if (children === undefined || children.length === 0) return false;
    const parentId = this.visibleParentMap.get(entryId);
    if (parentId === null || parentId === undefined) return true;
    const siblings = this.visibleChildrenMap.get(parentId);
    return siblings !== undefined && siblings.length > 1;
  }

  private findBranchSegmentStart(direction: "up" | "down"): number {
    const selectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
    if (selectedId === undefined || selectedId === "") return this.selectedIndex;

    const indexByEntryId = new Map(this.filteredNodes.map((node, i) => [node.node.entry.id, i]));
    let currentId: string = selectedId;
    if (direction === "down") {
      while (true) {
        const children: string[] = this.visibleChildrenMap.get(currentId) ?? [];
        const [firstChild] = children;
        if (firstChild === undefined) return indexByEntryId.get(currentId)!;
        if (children.length > 1) return indexByEntryId.get(firstChild)!;
        currentId = firstChild;
      }
    }

    while (true) {
      const parentId: string | null = this.visibleParentMap.get(currentId) ?? null;
      if (parentId === null) return indexByEntryId.get(currentId)!;
      const children = this.visibleChildrenMap.get(parentId) ?? [];
      if (children.length > 1) {
        const segmentStart = indexByEntryId.get(currentId)!;
        if (segmentStart < this.selectedIndex) {
          return segmentStart;
        }
      }
      currentId = parentId;
    }
  }
}

class SearchLine implements Component {
  private treeList: TreeList;

  constructor(treeList: TreeList) {
    this.treeList = treeList;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const query = this.treeList.getSearchQuery();
    if (query !== "") {
      return [
        truncateToWidth(
          `  ${theme.fg("muted", "Type to search:")} ${theme.fg("accent", query)}`,
          width,
        ),
      ];
    }
    return [truncateToWidth(`  ${theme.fg("muted", "Type to search:")}`, width)];
  }

  handleInput(_keyData: string): void {}
}

class TreeHelp implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    const items = TREE_HELP_ITEMS.map(({ keys, label, labelFirst }) => {
      const text = formatHelpKeys(keys);
      if (text === "") return label;
      return labelFirst === true ? `${label} ${text}` : `${text} ${label}`;
    });

    const availableWidth = Math.max(1, width);
    const indent = "  ";
    const separator = " · ";
    const lines: string[] = [];
    let currentLine = "";

    for (const item of items) {
      const candidate =
        currentLine === ""
          ? visibleWidth(`${indent}${item}`) <= availableWidth
            ? `${indent}${item}`
            : item
          : `${currentLine}${separator}${item}`;
      if (currentLine === "" || visibleWidth(candidate) <= availableWidth) {
        currentLine = candidate;
        continue;
      }

      lines.push(...wrapTextWithAnsi(currentLine.trimEnd(), availableWidth));
      currentLine = visibleWidth(`${indent}${item}`) <= availableWidth ? `${indent}${item}` : item;
    }

    if (currentLine !== "") {
      lines.push(...wrapTextWithAnsi(currentLine.trimEnd(), availableWidth));
    }

    return lines.map((line) => theme.fg("muted", line));
  }
}

const TREE_HELP_ITEMS: Array<{ keys: Keybinding[]; label: string; labelFirst?: boolean }> = [
  { keys: ["tui.select.up", "tui.select.down"], label: "move" },
  { keys: ["tui.editor.cursorLeft", "tui.editor.cursorRight"], label: "page" },
  { keys: ["app.tree.foldOrUp", "app.tree.unfoldOrDown"], label: "branch" },
  { keys: ["app.message.copy"], label: "copy" },
  { keys: ["app.tree.editLabel"], label: "label" },
  { keys: ["app.tree.toggleLabelTimestamp"], label: "label time" },
  {
    keys: [
      "app.tree.filter.default",
      "app.tree.filter.noTools",
      "app.tree.filter.userOnly",
      "app.tree.filter.labeledOnly",
      "app.tree.filter.all",
    ],
    label: "filters",
    labelFirst: true,
  },
  {
    keys: ["app.tree.filter.cycleForward", "app.tree.filter.cycleBackward"],
    label: "cycle",
    labelFirst: true,
  },
];

function formatHelpKeys(keybindings: Keybinding[]): string {
  const keys: string[] = [];
  for (const keybinding of keybindings) {
    const key = getKeybindings().getKeys(keybinding)[0];
    if (key !== undefined) keys.push(key);
  }
  if (keys.length === 0) return "";

  return formatKeyText(compactRawKeys(keys))
    .replace(/\bpageUp\b/gu, "pgup")
    .replace(/\bpageDown\b/gu, "pgdn")
    .replace(/\bup\b/gu, "↑")
    .replace(/\bdown\b/gu, "↓")
    .replace(/\bleft\b/gu, "←")
    .replace(/\bright\b/gu, "→");
}

function compactRawKeys(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;

  const parts = keys.map((key) => {
    const separatorIndex = key.lastIndexOf("+");
    return separatorIndex === -1
      ? { prefix: "", suffix: key }
      : { prefix: key.slice(0, separatorIndex + 1), suffix: key.slice(separatorIndex + 1) };
  });
  const prefix = parts[0]!.prefix;
  return prefix !== "" && parts.every((part) => part.prefix === prefix)
    ? `${prefix}${parts.map((part) => part.suffix).join("/")}`
    : keys.join("/");
}

class LabelInput implements Component, Focusable {
  private input: Input;
  private entryId: string;
  public onSubmit?: (entryId: string, label: string | undefined) => void;
  public onCancel?: () => void;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value;
  }

  constructor(entryId: string, currentLabel: string | undefined) {
    this.entryId = entryId;
    this.input = new Input();
    if (currentLabel !== undefined && currentLabel !== "") {
      this.input.setValue(currentLabel);
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const indent = "  ";
    const availableWidth = width - indent.length;
    lines.push(truncateToWidth(`${indent}${theme.fg("muted", "Label (empty to remove):")}`, width));
    lines.push(
      ...this.input
        .render(availableWidth)
        .map((line) => truncateToWidth(`${indent}${line}`, width)),
    );
    lines.push(
      truncateToWidth(
        `${indent}${keyHint("tui.select.confirm", "save")}  ${keyHint("tui.select.cancel", "cancel")}`,
        width,
      ),
    );
    return lines;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.confirm")) {
      const value = this.input.getValue().trim();
      this.onSubmit?.(this.entryId, value || undefined);
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel?.();
    } else {
      this.input.handleInput(keyData);
    }
  }
}

export class TreeSelectorComponent extends Container implements Focusable {
  private treeList: TreeList;
  private labelInput: LabelInput | null = null;
  private labelInputContainer: Container;
  private treeContainer: Container;
  private onLabelChangeCallback?:
    | ((entryId: string, label: string | undefined) => void)
    | undefined;
  public onCopy?: (text: string | undefined) => void;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    if (this.labelInput !== null) {
      this.labelInput.focused = value;
    }
  }

  constructor(
    tree: SessionTreeNode[],
    currentLeafId: string | null,
    terminalHeight: number,
    onSelect: (entryId: string) => void,
    onCancel: () => void,
    onLabelChange?: (entryId: string, label: string | undefined) => void,
    initialSelectedId?: string,
    initialFilterMode?: FilterMode,
  ) {
    super();

    this.onLabelChangeCallback = onLabelChange;
    const maxVisibleLines = Math.max(5, Math.floor(terminalHeight / 2));

    this.treeList = new TreeList(
      tree,
      currentLeafId,
      maxVisibleLines,
      initialSelectedId,
      initialFilterMode,
    );
    this.treeList.onSelect = onSelect;
    this.treeList.onCancel = onCancel;
    this.treeList.onCopy = (text) => this.onCopy?.(text);
    this.treeList.onLabelEdit = (entryId, currentLabel) =>
      this.showLabelInput(entryId, currentLabel);

    this.treeContainer = new Container();
    this.treeContainer.addChild(this.treeList);

    this.labelInputContainer = new Container();

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.addChild(new Text(theme.bold("  Session Tree"), 1, 0));
    this.addChild(new TreeHelp());
    this.addChild(new SearchLine(this.treeList));
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(this.treeContainer);
    this.addChild(this.labelInputContainer);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());

    if (tree.length === 0) {
      schedule(() => onCancel(), 100);
    }
  }

  private showLabelInput(entryId: string, currentLabel: string | undefined): void {
    this.labelInput = new LabelInput(entryId, currentLabel);
    this.labelInput.onSubmit = (id, label) => {
      this.treeList.updateNodeLabel(id, label);
      this.onLabelChangeCallback?.(id, label);
      this.hideLabelInput();
    };
    this.labelInput.onCancel = () => this.hideLabelInput();

    this.labelInput.focused = this.focusedState;

    this.treeContainer.clear();
    this.labelInputContainer.clear();
    this.labelInputContainer.addChild(this.labelInput);
  }

  private hideLabelInput(): void {
    this.labelInput = null;
    this.labelInputContainer.clear();
    this.treeContainer.clear();
    this.treeContainer.addChild(this.treeList);
  }

  handleInput(keyData: string): void {
    if (this.labelInput === null) {
      this.treeList.handleInput(keyData);
    } else {
      this.labelInput.handleInput(keyData);
    }
  }

  getTreeList(): TreeList {
    return this.treeList;
  }
}
