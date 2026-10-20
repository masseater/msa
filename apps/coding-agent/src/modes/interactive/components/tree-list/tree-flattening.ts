import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import type treeListInternalTypes from "../tree-list-internal.types.ts";
import type TreeList from "../tree-list.ts";

export default class TreeFlattening {
  private readonly list: TreeList;

  constructor(list: TreeList) {
    this.list = list;
  }

  buildActivePath(): void {
    this.list.activePathIds.clear();
    if (this.list.currentLeafId === null || this.list.currentLeafId === "") return;

    const entryMap = new Map<string, treeListInternalTypes.FlatNode>();
    for (const flatNode of this.list.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    let currentId: string | null = this.list.currentLeafId;
    while (currentId !== null && currentId !== "") {
      this.list.activePathIds.add(currentId);
      const node = entryMap.get(currentId);
      if (node === undefined) break;
      currentId = node.node.entry.parentId ?? null;
    }
  }

  private collectToolCalls(content: unknown) {
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "toolCall"
        ) {
          const tc = block as { id: string; name: string; arguments: Record<string, unknown> };
          this.list.toolCallMap.set(tc.id, { arguments: tc.arguments, name: tc.name });
        }
      }
    }
  }

  private pushRoot(
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

  private pushChildren(
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

  private prepareFlatten(roots: sessionManagerTypes.SessionTreeNode[]) {
    this.list.toolCallMap.clear();

    type StackItem = [
      sessionManagerTypes.SessionTreeNode,
      number,
      boolean,
      boolean,
      boolean,
      treeListInternalTypes.GutterInfo[],
      boolean,
    ];
    const stack: StackItem[] = [];

    const containsActive = new Map<sessionManagerTypes.SessionTreeNode, boolean>();
    const leafId = this.list.currentLeafId;
    {
      const allNodes: sessionManagerTypes.SessionTreeNode[] = [];
      const preOrderStack: sessionManagerTypes.SessionTreeNode[] = [...roots];
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
    return { containsActive, multipleRoots, orderedRoots, stack };
  }

  private emitNode(
    node: sessionManagerTypes.SessionTreeNode,
    result: treeListInternalTypes.FlatNode[],
    gutters: treeListInternalTypes.GutterInfo[],
    indent: number,
    isLast: boolean,
    isVirtualRootChild: boolean,
    showConnector: boolean,
    containsActive: Map<sessionManagerTypes.SessionTreeNode, boolean>,
    justBranched: boolean,
  ) {
    const entry = node.entry;
    if (entry.type === "message" && entry.message.role === "assistant") {
      const content = (entry.message as { content?: unknown }).content;
      this.collectToolCalls(content);
    }

    result.push({ gutters, indent, isLast, isVirtualRootChild, node, showConnector });

    const children = node.children;
    const multipleChildren = children.length > 1;

    const orderedChildren = (() => {
      const prioritized: sessionManagerTypes.SessionTreeNode[] = [];
      const rest: sessionManagerTypes.SessionTreeNode[] = [];
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
    return { childIndent, connectorDisplayed, multipleChildren, orderedChildren };
  }

  flattenTree(roots: sessionManagerTypes.SessionTreeNode[]): treeListInternalTypes.FlatNode[] {
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
    } = this.prepareFlatten(roots);
    for (let i = orderedRoots.length - 1; i >= 0; i--) {
      const root = orderedRoots[i];
      if (root === undefined) continue;
      this.pushRoot(i, orderedRoots, stack, root, multipleRoots);
    }

    while (stack.length > 0) {
      const [node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] =
        stack.pop()!;

      this.visitNode(
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

  private visitNode(
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
    const { connectorDisplayed, orderedChildren, childIndent, multipleChildren } = this.emitNode(
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
    const currentDisplayIndent = this.list.multipleRoots ? Math.max(0, indent - 1) : indent;
    const connectorPosition = Math.max(0, currentDisplayIndent - 1);
    this.pushChildren(
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
}
