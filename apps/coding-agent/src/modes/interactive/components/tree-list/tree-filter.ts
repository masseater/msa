import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import type treeListInternalTypes from "../tree-list-internal.types.ts";
import type TreeList from "../tree-list.ts";

export default class TreeFilter {
  private readonly list: TreeList;

  constructor(list: TreeList) {
    this.list = list;
  }

  private getSearchableText(node: sessionManagerTypes.SessionTreeNode): string {
    const { entry, parts }: { entry: sessionManagerTypes.SessionEntry; parts: string[] } =
      this.searchableEntryText(node);

    switch (entry.type) {
      case "message": {
        this.searchableMessageText(entry, parts);
        break;
      }
      case "custom_message": {
        parts.push(entry.customType);
        if (typeof entry.content === "string") {
          parts.push(entry.content);
        } else {
          parts.push(this.list.entryText.extractContent(entry.content));
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

  private searchableEntryText(node: sessionManagerTypes.SessionTreeNode) {
    const entry = node.entry;
    const parts: string[] = [];

    if (node.label !== undefined && node.label !== "") {
      parts.push(node.label);
    }
    return { entry, parts };
  }

  private searchableMessageText(entry: sessionManagerTypes.SessionMessageEntry, parts: string[]) {
    const msg = entry.message;
    parts.push(msg.role);
    if ("content" in msg && msg.content !== "") {
      parts.push(this.list.entryText.extractContent(msg.content));
    }
    if (msg.role === "bashExecution") {
      const bashMsg = msg as { command?: string };
      if (bashMsg.command !== undefined && bashMsg.command !== "") parts.push(bashMsg.command);
    }
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

  findNearestVisibleIndex(entryId: string | null): number {
    if (this.list.filteredNodes.length === 0) return 0;

    const entryMap = new Map<string, treeListInternalTypes.FlatNode>();
    for (const flatNode of this.list.flatNodes) {
      entryMap.set(flatNode.node.entry.id, flatNode);
    }

    const visibleIdToIndex = new Map<string, number>(
      this.list.filteredNodes.map((node, i) => [node.node.entry.id, i]),
    );

    let currentId = entryId;
    while (currentId !== null) {
      const index = visibleIdToIndex.get(currentId);
      if (index !== undefined) return index;
      const node = entryMap.get(currentId);
      if (node === undefined) break;
      currentId = node.node.entry.parentId ?? null;
    }

    return this.list.filteredNodes.length - 1;
  }

  applyFilter(): void {
    if (this.list.filteredNodes.length > 0) {
      this.list.lastSelectedId =
        this.list.filteredNodes[this.list.selectedIndex]?.node.entry.id ?? this.list.lastSelectedId;
    }

    const searchTokens = this.list.searchQuery.toLowerCase().split(/\s+/u).filter(Boolean);

    this.list.filteredNodes = this.list.flatNodes.filter((flatNode) => {
      const entry = flatNode.node.entry;
      if (entry.type === "usage") return false;
      const isCurrentLeaf = entry.id === this.list.currentLeafId;

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

      let passesFilter: boolean = this.passesFilterMode(entry, flatNode);

      if (!passesFilter) return false;

      if (searchTokens.length > 0) {
        const nodeText = this.getSearchableText(flatNode.node).toLowerCase();
        return searchTokens.every((token) => nodeText.includes(token));
      }

      return true;
    });

    this.nodeMatchesSearch();
  }

  private passesFilterMode(
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

    switch (this.list.filterMode) {
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

  nodeMatchesSearch(): void {
    if (this.list.foldedNodes.size > 0) {
      const skipSet = new Set<string>();
      for (const flatNode of this.list.flatNodes) {
        const { id, parentId } = flatNode.node.entry;
        if (parentId !== null && (this.list.foldedNodes.has(parentId) || skipSet.has(parentId))) {
          skipSet.add(id);
        }
      }
      this.list.filteredNodes = this.list.filteredNodes.filter(
        (flatNode) => !skipSet.has(flatNode.node.entry.id),
      );
    }

    this.list.layout.recalculateVisualStructure();

    if (this.list.lastSelectedId !== null && this.list.lastSelectedId !== "") {
      this.list.selectedIndex = this.findNearestVisibleIndex(this.list.lastSelectedId);
    } else if (this.list.selectedIndex >= this.list.filteredNodes.length) {
      this.list.selectedIndex = Math.max(0, this.list.filteredNodes.length - 1);
    }

    if (this.list.filteredNodes.length > 0) {
      this.list.lastSelectedId =
        this.list.filteredNodes[this.list.selectedIndex]?.node.entry.id ?? this.list.lastSelectedId;
    }
  }
}
