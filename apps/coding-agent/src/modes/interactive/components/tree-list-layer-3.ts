import platform from "../../../core/platform.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeListLayer2 from "./tree-list-layer-2.ts";
import TreeList from "./tree-list.ts";

const { nowMs, toDate } = platform;

export default abstract class TreeListLayer3 extends TreeListLayer2 {
  protected flattenTreePart4(
    i: number,
    orderedRoots: sessionManagerTypes.SessionTreeNode[],
    stack: [
      sessionManagerTypes.SessionTreeNode,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][],
    root: sessionManagerTypes.SessionTreeNode,
    multipleRoots: boolean,
  ) {
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

  protected flattenTreePart3Part1(
    connectorDisplayed: boolean,
    gutters: treeListInternalTypes.GutterInfo[],
    connectorPosition: number,
    isLast: boolean,
    orderedChildren: sessionManagerTypes.SessionTreeNode[],
    stack: [
      sessionManagerTypes.SessionTreeNode,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ][],
    childIndent: number,
    multipleChildren: boolean,
  ) {
    const childGutters: treeListInternalTypes.GutterInfo[] = connectorDisplayed
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

  recalculateVisualStructure(): void {
    if (this.filteredNodes.length === 0) return;

    const {
      visibleRootIds,
      stack,
      filteredNodeMap,
      visibleChildren,
      visibleParent,
    }: {
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
    } = this.recalculateVisualStructurePart24();

    this.recalculateVisualStructurePart2(visibleRootIds, stack);

    while (stack.length > 0) {
      const [nodeId, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] =
        stack.pop()!;

      const flatNode = filteredNodeMap.get(nodeId);
      if (flatNode === undefined) continue;

      let { children, childIndent, multipleChildren, childGutters } =
        TreeList.recalculateVisualStructureChildren(
          this as unknown as TreeList,
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

  protected recalculateVisualStructurePart24(): {
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
    return this.recalculateVisualStructurePart23();
  }

  protected recalculateVisualStructurePart23(): {
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
    return this.recalculateVisualStructurePart22();
  }

  protected recalculateVisualStructurePart22(): {
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
    return this.recalculateVisualStructurePart21();
  }

  protected recalculateVisualStructurePart21(): {
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
    return this.recalculateVisualStructurePart20();
  }

  protected recalculateVisualStructurePart20(): {
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
    return this.recalculateVisualStructurePart19();
  }

  protected recalculateVisualStructurePart19(): {
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
    return this.recalculateVisualStructurePart18();
  }

  protected recalculateVisualStructurePart18(): {
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
    return this.recalculateVisualStructurePart17();
  }

  protected recalculateVisualStructurePart17(): {
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
    return this.recalculateVisualStructurePart16();
  }

  protected recalculateVisualStructurePart16(): {
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
    return this.recalculateVisualStructurePart15();
  }

  formatLabelTimestamp(timestamp: string): string {
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
}
