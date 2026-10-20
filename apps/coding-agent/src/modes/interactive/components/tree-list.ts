import platform from "../../../core/platform.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeEntryText from "./tree-list/tree-entry-text.ts";
import TreeFilter from "./tree-list/tree-filter.ts";
import TreeFlattening from "./tree-list/tree-flattening.ts";
import TreeInput from "./tree-list/tree-input.ts";
import TreeLayout from "./tree-list/tree-layout.ts";
import TreeRendering from "./tree-list/tree-rendering.ts";
import type treeSelectorTypes from "./tree-selector.types.ts";

const { nowIso } = platform;

export default class TreeList {
  readonly flattening: TreeFlattening;
  readonly filter: TreeFilter;
  readonly layout: TreeLayout;
  readonly entryText: TreeEntryText;
  readonly rendering: TreeRendering;
  readonly input: TreeInput;

  flatNodes: treeListInternalTypes.FlatNode[] = [];

  filteredNodes: treeListInternalTypes.FlatNode[] = [];

  selectedIndex = 0;

  currentLeafId!: string | null;

  maxVisibleLines!: number;

  filterMode: treeSelectorTypes.FilterMode = "default";

  searchQuery = "";

  toolCallMap: Map<string, treeListInternalTypes.ToolCallInfo> = new Map();

  multipleRoots = false;

  showLabelTimestamps = false;

  activePathIds: Set<string> = new Set();

  visibleParentMap: Map<string, string | null> = new Map();

  visibleChildrenMap: Map<string | null, string[]> = new Map();

  lastSelectedId: string | null = null;

  foldedNodes: Set<string> = new Set();

  onSelect?: (entryId: string) => void;

  onCancel?: () => void;

  onCopy?: (text: string | undefined) => void;

  onLabelEdit?: (entryId: string, currentLabel: string | undefined) => void;

  invalidate(): void {}

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getSelectedNode(): sessionManagerTypes.SessionTreeNode | undefined {
    return this.filteredNodes[this.selectedIndex]?.node;
  }

  copySelected(): void {
    const node = this.getSelectedNode();
    this.onCopy?.(node === undefined ? undefined : this.entryText.getEntryCopyText(node));
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

  render(width: number): string[] {
    return this.rendering.render(width);
  }

  handleInput(keyData: string): void {
    this.input.handle(keyData);
  }

  constructor(
    tree: sessionManagerTypes.SessionTreeNode[],
    currentLeafId: string | null,
    maxVisibleLines: number,
    initialSelectedId?: string,
    initialFilterMode?: treeSelectorTypes.FilterMode,
  ) {
    this.flattening = new TreeFlattening(this);
    this.filter = new TreeFilter(this);
    this.layout = new TreeLayout(this);
    this.entryText = new TreeEntryText(this);
    this.rendering = new TreeRendering(this);
    this.input = new TreeInput(this);
    this.currentLeafId = currentLeafId;
    this.maxVisibleLines = maxVisibleLines;
    this.filterMode = initialFilterMode ?? "default";
    this.multipleRoots = tree.length > 1;
    this.flatNodes = this.flattening.flattenTree(tree);
    this.flattening.buildActivePath();
    this.filter.applyFilter();

    const targetId = initialSelectedId ?? currentLeafId;
    this.selectedIndex = this.filter.findNearestVisibleIndex(targetId);
    this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? null;
  }
}
