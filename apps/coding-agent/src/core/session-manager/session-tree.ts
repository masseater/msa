import platform from "../platform.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionContext from "./session-context.ts";

const { buildContextEntries, buildSessionProjection } = sessionContext;
const { toEpochMs } = platform;

export default class SessionTree {
  fileEntries: sessionManagerTypes.FileEntry[] = [];

  byId: Map<string, sessionManagerTypes.SessionEntry> = new Map();

  labelsById: Map<string, string> = new Map();

  labelTimestampsById: Map<string, string> = new Map();

  leafId: string | null = null;

  buildIndex(): void {
    this.byId.clear();
    this.labelsById.clear();
    this.labelTimestampsById.clear();
    this.leafId = null;
    for (const entry of this.fileEntries) {
      if (entry.type === "session") continue;
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
      if (entry.type === "label") {
        if (entry.label !== undefined && entry.label !== "") {
          this.labelsById.set(entry.targetId, entry.label);
          this.labelTimestampsById.set(entry.targetId, entry.timestamp);
        } else {
          this.labelsById.delete(entry.targetId);
          this.labelTimestampsById.delete(entry.targetId);
        }
      }
    }
  }

  hasConversation(): boolean {
    return this.fileEntries.some(
      (e) => e.type === "message" && (e.message.role === "user" || e.message.role === "assistant"),
    );
  }

  getSessionName(): string | undefined {
    for (let i = this.fileEntries.length - 1; i >= 0; i--) {
      const entry = this.fileEntries[i];
      if (entry?.type === "session_info") {
        return entry.name?.trim() || undefined;
      }
    }
    return undefined;
  }

  getLeafId(): string | null {
    return this.leafId;
  }

  getLeafEntry(): sessionManagerTypes.SessionEntry | undefined {
    return this.leafId !== null && this.leafId !== "" ? this.byId.get(this.leafId) : undefined;
  }

  getEntry(id: string): sessionManagerTypes.SessionEntry | undefined {
    return this.byId.get(id);
  }

  getChildren(parentId: string): sessionManagerTypes.SessionEntry[] {
    const children: sessionManagerTypes.SessionEntry[] = [];
    for (const entry of this.byId.values()) {
      if (entry.parentId === parentId) {
        children.push(entry);
      }
    }
    return children;
  }

  getLabel(id: string): string | undefined {
    return this.labelsById.get(id);
  }

  getBranch(fromId?: string): sessionManagerTypes.SessionEntry[] {
    const path: sessionManagerTypes.SessionEntry[] = [];
    const startId = fromId ?? this.leafId;
    let current = startId !== null && startId !== "" ? this.byId.get(startId) : undefined;
    while (current !== undefined) {
      path.push(current);
      current =
        current.parentId !== null && current.parentId !== ""
          ? this.byId.get(current.parentId)
          : undefined;
    }
    path.reverse();
    return path;
  }

  buildContextEntries(): sessionManagerTypes.SessionEntry[] {
    return buildContextEntries(this.getEntries(), this.leafId, this.byId);
  }

  buildSessionProjection(): sessionManagerTypes.SessionProjection {
    return buildSessionProjection(this.getEntries(), this.leafId, this.byId);
  }

  buildSessionContext(): sessionManagerTypes.SessionContext {
    const { messages, thinkingLevel, model } = this.buildSessionProjection();
    return { messages, model, thinkingLevel };
  }

  getHeader(): sessionManagerTypes.SessionHeader | null {
    const h = this.fileEntries.find((e) => e.type === "session");
    return h === undefined ? null : (h as sessionManagerTypes.SessionHeader);
  }

  getEntryCount(): number {
    return this.byId.size;
  }

  getEntries(): sessionManagerTypes.SessionEntry[] {
    return this.fileEntries.filter(
      (e): e is sessionManagerTypes.SessionEntry => e.type !== "session",
    );
  }

  branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;
  }

  resetLeaf(): void {
    this.leafId = null;
  }

  getTree(): sessionManagerTypes.SessionTreeNode[] {
    const entries = this.getEntries();
    const nodeMap = new Map<string, sessionManagerTypes.SessionTreeNode>();
    const roots: sessionManagerTypes.SessionTreeNode[] = [];

    for (const entry of entries) {
      const label = this.labelsById.get(entry.id);
      const labelTimestamp = this.labelTimestampsById.get(entry.id);
      nodeMap.set(entry.id, { children: [], entry, label, labelTimestamp });
    }

    for (const entry of entries) {
      const node = nodeMap.get(entry.id)!;
      if (entry.parentId === null || entry.parentId === entry.id) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(entry.parentId);
        if (parent === undefined) {
          roots.push(node);
        } else {
          parent.children.push(node);
        }
      }
    }

    const stack: sessionManagerTypes.SessionTreeNode[] = [...roots];
    while (stack.length > 0) {
      const node = stack.pop()!;
      node.children.sort((a, b) => toEpochMs(a.entry.timestamp) - toEpochMs(b.entry.timestamp));
      stack.push(...node.children);
    }

    return roots;
  }
}
