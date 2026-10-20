import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import renderUtils from "../../../core/tools/render-utils.ts";
import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeListLayer3 from "./tree-list-layer-3.ts";
import TreeList from "./tree-list.ts";
import type treeSelectorTypes from "./tree-selector.types.ts";

const { formatReadLineRange, shortenPath } = renderUtils;

export default abstract class TreeListLayer4 extends TreeListLayer3 {
  protected flattenTreePart2(roots: sessionManagerTypes.SessionTreeNode[]) {
    this.toolCallMap.clear();

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
    const leafId = this.currentLeafId;
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

  protected flattenTreePart1(
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
      this.flattenTreePart1Part1(content);
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

  applyFilter(): void {
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

      let passesFilter: boolean = this.applyFilterPart2(entry, flatNode);

      if (!passesFilter) return false;

      if (searchTokens.length > 0) {
        const nodeText = this.getSearchableText(flatNode.node).toLowerCase();
        return searchTokens.every((token) => nodeText.includes(token));
      }

      return true;
    });

    TreeList.applyFilterPart1(this as unknown as TreeList);
  }

  protected applyFilterPart2(
    entry:
      | sessionManagerTypes.SessionMessageEntry
      | sessionManagerTypes.ThinkingLevelChangeEntry
      | sessionManagerTypes.ModelChangeEntry
      | sessionManagerTypes.CompactionEntry<unknown>
      | sessionManagerTypes.BranchSummaryEntry<unknown>
      | sessionManagerTypes.CustomEntry<unknown>
      | sessionManagerTypes.CustomMessageEntry<unknown>
      | sessionManagerTypes.ContextEditEntry
      | sessionManagerTypes.LabelEntry
      | sessionManagerTypes.SessionInfoEntry,
    flatNode: treeListInternalTypes.FlatNode,
  ) {
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
    return passesFilter;
  }

  protected formatToolCall(name: string, args: Record<string, unknown>): string {
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

  protected handleInputPart7() {
    if (this.searchQuery.length > 0) {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.foldedNodes.clear();
      this.applyFilter();
    }
  }

  protected handleInputPart6() {
    const modes: treeSelectorTypes.FilterMode[] = [
      "default",
      "no-tools",
      "user-only",
      "labeled-only",
      "all",
    ];
    const currentIndex = modes.indexOf(this.filterMode);
    this.filterMode = modes[(currentIndex + 1) % modes.length] ?? "default";
    this.foldedNodes.clear();
    this.applyFilter();
  }

  protected handleInputPart5() {
    const modes: treeSelectorTypes.FilterMode[] = [
      "default",
      "no-tools",
      "user-only",
      "labeled-only",
      "all",
    ];
    const currentIndex = modes.indexOf(this.filterMode);
    this.filterMode = modes[(currentIndex - 1 + modes.length) % modes.length] ?? "default";
    this.foldedNodes.clear();
    this.applyFilter();
  }
}
