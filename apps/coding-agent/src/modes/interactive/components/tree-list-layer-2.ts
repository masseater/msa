import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeListLayer1 from "./tree-list-layer-1.ts";
import TreeList from "./tree-list.ts";

export default abstract class TreeListLayer2 extends TreeListLayer1 {
  findNearestVisibleIndex(entryId: string | null): number {
    if (this.filteredNodes.length === 0) return 0;

    const entryMap = new Map<string, treeListInternalTypes.FlatNode>();
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

  protected recalculateVisualStructurePart15(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart14();
  }

  protected recalculateVisualStructurePart14(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart13();
  }

  protected recalculateVisualStructurePart13(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart12();
  }

  protected recalculateVisualStructurePart12(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart11();
  }

  protected recalculateVisualStructurePart11(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart10();
  }

  protected recalculateVisualStructurePart10(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart9();
  }

  protected recalculateVisualStructurePart9(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart8();
  }

  protected recalculateVisualStructurePart8(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart7();
  }

  protected recalculateVisualStructurePart7(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart6();
  }

  protected recalculateVisualStructurePart6(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart5();
  }

  protected recalculateVisualStructurePart5(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart4();
  }

  protected recalculateVisualStructurePart4(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart3();
  }

  protected recalculateVisualStructurePart3(): {
    visibleRootIds: string[];
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][];
    filteredNodeMap: Map<string, treeListInternalTypes.FlatNode>;
    visibleChildren: Map<string | null, string[]>;
    visibleParent: Map<string, string | null>;
  } {
    return this.recalculateVisualStructurePart1();
  }

  protected recalculateVisualStructurePart2(
    visibleRootIds: string[],
    stack: [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][],
  ) {
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
  }

  protected recalculateVisualStructurePart1() {
    const visibleIds = new Set(this.filteredNodes.map((n) => n.node.entry.id));

    const entryMap = new Map<string, treeListInternalTypes.FlatNode>();
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

    const filteredNodeMap = new Map<string, treeListInternalTypes.FlatNode>();
    for (const flatNode of this.filteredNodes) {
      filteredNodeMap.set(flatNode.node.entry.id, flatNode);
    }

    type StackItem = [
      string,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ];
    const stack: StackItem[] = [];
    return { filteredNodeMap, stack, visibleChildren, visibleParent, visibleRootIds };
  }

  protected renderPart1(
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
    } = TreeList.renderTotalChars(this as unknown as TreeList, startIndex, offset, flatNode);
    const { prefix, foldMarker, pathMarker, label } = TreeList.renderPrefix(
      this as unknown as TreeList,
      totalChars,
      flatNode,
      prefixChars,
      connector,
      connectorPosition,
      entry,
      isFolded,
    );
    TreeList.renderPart3(
      this as unknown as TreeList,
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
}
