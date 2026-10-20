import platform from "../../../core/platform.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import type treeListInternalTypes from "./tree-list-internal.types.ts";
import TreeListLayer0 from "./tree-list-layer-0.ts";

const { nowIso } = platform;

export default abstract class TreeListLayer1 extends TreeListLayer0 {
  protected buildActivePath(): void {
    this.activePathIds.clear();
    if (this.currentLeafId === null || this.currentLeafId === "") return;

    const entryMap = new Map<string, treeListInternalTypes.FlatNode>();
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

  protected flattenTreePart1Part1(content: unknown) {
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "toolCall"
        ) {
          const tc = block as { id: string; name: string; arguments: Record<string, unknown> };
          this.toolCallMap.set(tc.id, { arguments: tc.arguments, name: tc.name });
        }
      }
    }
  }

  protected getSearchableText(node: sessionManagerTypes.SessionTreeNode): string {
    const { entry, parts }: { entry: sessionManagerTypes.SessionEntry; parts: string[] } =
      this.getSearchableTextPart2(node);

    switch (entry.type) {
      case "message": {
        this.getSearchableTextPart1(entry, parts);
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

  protected getSearchableTextPart2(node: sessionManagerTypes.SessionTreeNode) {
    const entry = node.entry;
    const parts: string[] = [];

    if (node.label !== undefined && node.label !== "") {
      parts.push(node.label);
    }
    return { entry, parts };
  }

  protected getSearchableTextPart1(
    entry: sessionManagerTypes.SessionMessageEntry,
    parts: string[],
  ) {
    const msg = entry.message;
    parts.push(msg.role);
    if ("content" in msg && msg.content !== "") {
      parts.push(this.extractContent(msg.content));
    }
    if (msg.role === "bashExecution") {
      const bashMsg = msg as { command?: string };
      if (bashMsg.command !== undefined && bashMsg.command !== "") parts.push(bashMsg.command);
    }
  }

  invalidate(): void {}

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getSelectedNode(): sessionManagerTypes.SessionTreeNode | undefined {
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

  protected getStatusLabels(): string {
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

  protected getEntryDisplayTextPart1(entry: sessionManagerTypes.CustomMessageEntry<unknown>) {
    return typeof entry.content === "string"
      ? entry.content
      : entry.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
  }

  protected extractContent(content: unknown): string {
    return this.extractFullContent(content).slice(0, 200);
  }

  protected extractFullContent(content: unknown): string {
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

  protected getEntryCopyText(node: sessionManagerTypes.SessionTreeNode): string | undefined {
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

  protected hasTextContent(content: unknown): boolean {
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

  isFoldable(entryId: string): boolean {
    const children = this.visibleChildrenMap.get(entryId);
    if (children === undefined || children.length === 0) return false;
    const parentId = this.visibleParentMap.get(entryId);
    if (parentId === null || parentId === undefined) return true;
    const siblings = this.visibleChildrenMap.get(parentId);
    return siblings !== undefined && siblings.length > 1;
  }

  findBranchSegmentStart(direction: "up" | "down"): number {
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
