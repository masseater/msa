import type treeListInternalTypes from "../tree-list-internal.types.ts";
import type TreeList from "../tree-list.ts";

type LayoutItem = {
  nodeId: string;
  indent: number;
  justBranched: boolean;
  showConnector: boolean;
  isLast: boolean;
  gutters: treeListInternalTypes.GutterInfo[];
  isVirtualRootChild: boolean;
};

export default class TreeLayout {
  private readonly list: TreeList;

  constructor(list: TreeList) {
    this.list = list;
  }

  isFoldable(entryId: string): boolean {
    const children = this.list.visibleChildrenMap.get(entryId);
    if (children === undefined || children.length === 0) return false;
    const parentId = this.list.visibleParentMap.get(entryId);
    if (parentId === null || parentId === undefined) return true;
    const siblings = this.list.visibleChildrenMap.get(parentId);
    return siblings !== undefined && siblings.length > 1;
  }

  findBranchSegmentStart(direction: "up" | "down"): number {
    const selectedId = this.list.filteredNodes[this.list.selectedIndex]?.node.entry.id;
    if (selectedId === undefined || selectedId === "") return this.list.selectedIndex;

    const indexByEntryId = new Map(
      this.list.filteredNodes.map((node, i) => [node.node.entry.id, i]),
    );
    let currentId: string = selectedId;
    if (direction === "down") {
      while (true) {
        const children: string[] = this.list.visibleChildrenMap.get(currentId) ?? [];
        const [firstChild] = children;
        if (firstChild === undefined) return indexByEntryId.get(currentId)!;
        if (children.length > 1) return indexByEntryId.get(firstChild)!;
        currentId = firstChild;
      }
    }

    while (true) {
      const parentId: string | null = this.list.visibleParentMap.get(currentId) ?? null;
      if (parentId === null) return indexByEntryId.get(currentId)!;
      const children = this.list.visibleChildrenMap.get(parentId) ?? [];
      if (children.length > 1) {
        const segmentStart = indexByEntryId.get(currentId)!;
        if (segmentStart < this.list.selectedIndex) {
          return segmentStart;
        }
      }
      currentId = parentId;
    }
  }

  recalculateVisualStructure(): void {
    const { list } = this;
    if (list.filteredNodes.length === 0) return;

    const { visibleChildren, visibleParent } = this.visibleTreeMaps();
    const visibleRootIds = visibleChildren.get(null) ?? [];
    list.multipleRoots = visibleRootIds.length > 1;
    const nodeById = new Map(list.filteredNodes.map((node) => [node.node.entry.id, node]));

    const roots = list.multipleRoots;
    const stack: LayoutItem[] = visibleRootIds
      .map((nodeId, i) => ({
        gutters: [],
        indent: roots ? 1 : 0,
        isLast: i === visibleRootIds.length - 1,
        isVirtualRootChild: roots,
        justBranched: roots,
        nodeId,
        showConnector: roots,
      }))
      .toReversed();

    while (stack.length > 0) {
      const item = stack.pop()!;
      const flatNode = nodeById.get(item.nodeId);
      if (flatNode === undefined) continue;
      stack.push(...this.layoutNode(item, flatNode, visibleChildren).toReversed());
    }

    list.visibleParentMap = visibleParent;
    list.visibleChildrenMap = visibleChildren;
  }

  private visibleTreeMaps() {
    const { list } = this;
    const visibleIds = new Set(list.filteredNodes.map((n) => n.node.entry.id));
    const entryMap = new Map(list.flatNodes.map((node) => [node.node.entry.id, node]));

    const findVisibleAncestor = (nodeId: string): string | null => {
      let currentId = entryMap.get(nodeId)?.node.entry.parentId ?? null;
      while (currentId !== null && !visibleIds.has(currentId)) {
        currentId = entryMap.get(currentId)?.node.entry.parentId ?? null;
      }
      return currentId;
    };

    const visibleParent = new Map<string, string | null>();
    const visibleChildren = new Map<string | null, string[]>([[null, []]]);
    for (const flatNode of list.filteredNodes) {
      const nodeId = flatNode.node.entry.id;
      const ancestorId = findVisibleAncestor(nodeId);
      visibleParent.set(nodeId, ancestorId);
      const siblings = visibleChildren.get(ancestorId) ?? [];
      siblings.push(nodeId);
      visibleChildren.set(ancestorId, siblings);
    }
    return { visibleChildren, visibleParent };
  }

  private layoutNode(
    item: LayoutItem,
    flatNode: treeListInternalTypes.FlatNode,
    visibleChildren: Map<string | null, string[]>,
  ): LayoutItem[] {
    const { indent, showConnector, isLast, gutters, isVirtualRootChild, justBranched } = item;
    flatNode.indent = indent;
    flatNode.showConnector = showConnector;
    flatNode.isLast = isLast;
    flatNode.gutters = gutters;
    flatNode.isVirtualRootChild = isVirtualRootChild;

    const children = visibleChildren.get(item.nodeId) ?? [];
    const multipleChildren = children.length > 1;
    const childIndent = multipleChildren || (justBranched && indent > 0) ? indent + 1 : indent;

    const currentDisplayIndent = this.list.multipleRoots ? Math.max(0, indent - 1) : indent;
    const childGutters: treeListInternalTypes.GutterInfo[] =
      showConnector && !isVirtualRootChild
        ? [...gutters, { position: Math.max(0, currentDisplayIndent - 1), show: !isLast }]
        : gutters;
    return children.map((nodeId, i) => ({
      gutters: childGutters,
      indent: childIndent,
      isLast: i === children.length - 1,
      isVirtualRootChild: false,
      justBranched: multipleChildren,
      nodeId,
      showConnector: multipleChildren,
    }));
  }
}
