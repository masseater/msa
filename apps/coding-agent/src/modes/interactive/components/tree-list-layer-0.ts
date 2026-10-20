import type treeListInternalTypes from "./tree-list-internal.types.ts";
import type treeSelectorTypes from "./tree-selector.types.ts";

export default abstract class TreeListLayer0 {
  flatNodes: treeListInternalTypes.FlatNode[] = [];
  filteredNodes: treeListInternalTypes.FlatNode[] = [];
  selectedIndex = 0;
  protected currentLeafId!: string | null;
  protected maxVisibleLines!: number;
  protected filterMode: treeSelectorTypes.FilterMode = "default";
  searchQuery = "";
  protected toolCallMap: Map<string, treeListInternalTypes.ToolCallInfo> = new Map();
  multipleRoots = false;
  showLabelTimestamps = false;
  activePathIds: Set<string> = new Set();
  protected visibleParentMap: Map<string, string | null> = new Map();
  protected visibleChildrenMap: Map<string | null, string[]> = new Map();
  lastSelectedId: string | null = null;
  foldedNodes: Set<string> = new Set();
  public onSelect?: (entryId: string) => void;
  public onCancel?: () => void;
  public onCopy?: (text: string | undefined) => void;
  public onLabelEdit?: (entryId: string, currentLabel: string | undefined) => void;
}
