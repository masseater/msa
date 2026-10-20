import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";
import SessionManagerLayer0 from "./session-manager-layer-0.ts";
import sessionManagerSupport from "./session-manager-support.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { appendFileSync, closeSync, openSync, writeFileSync } = nodeFs;
const { buildContextEntries, buildSessionProjection, generateId, getDefaultSessionDirPath } =
  sessionManagerSupport;
const { nowIso } = platform;

export default abstract class SessionManagerLayer1 extends SessionManagerLayer0 {
  protected buildIndex(): void {
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

  protected rewriteFile(): void {
    if (!this.persist || this.sessionFile === undefined || this.sessionFile === "") return;
    const fd = openSync(this.sessionFile, "w");
    try {
      for (const entry of this.fileEntries) {
        writeFileSync(fd, `${JSON.stringify(entry)}\n`);
      }
    } finally {
      closeSync(fd);
    }
  }

  isPersisted(): boolean {
    return this.persist;
  }

  getCwd(): string {
    return this.cwd;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  usesDefaultSessionDir(): boolean {
    return this.sessionDir === getDefaultSessionDirPath(this.cwd);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  protected hasConversation(): boolean {
    return this.fileEntries.some(
      (e) => e.type === "message" && (e.message.role === "user" || e.message.role === "assistant"),
    );
  }

  persistInternal(entry: sessionManagerTypes.SessionEntry): void {
    if (!this.persist || this.sessionFile === undefined || this.sessionFile === "") return;

    if (this.flushed) {
      appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    } else {
      if (!this.hasConversation()) return;
      const fd = openSync(this.sessionFile, "wx");
      try {
        for (const e of this.fileEntries) {
          writeFileSync(fd, `${JSON.stringify(e)}\n`);
        }
      } finally {
        closeSync(fd);
      }
      this.flushed = true;
    }
  }

  protected appendEntry(entry: sessionManagerTypes.SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.persistInternal(entry);
  }

  appendThinkingLevelChange(thinkingLevel: string): string {
    const entry: sessionManagerTypes.ThinkingLevelChangeEntry = {
      id: generateId(this.byId),
      parentId: this.leafId,
      thinkingLevel,
      timestamp: nowIso(),
      type: "thinking_level_change",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendModelChange(provider: string, modelId: string): string {
    const entry: sessionManagerTypes.ModelChangeEntry = {
      id: generateId(this.byId),
      modelId,
      parentId: this.leafId,
      provider,
      timestamp: nowIso(),
      type: "model_change",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    const entry: sessionManagerTypes.CustomEntry = {
      customType,
      data,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: nowIso(),
      type: "custom",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendSessionInfo(name: string): string {
    const sanitizedName = name.replace(/[\r\n]+/gu, " ").trim();
    const entry: sessionManagerTypes.SessionInfoEntry = {
      id: generateId(this.byId),
      name: sanitizedName,
      parentId: this.leafId,
      timestamp: nowIso(),
      type: "session_info",
    };
    this.appendEntry(entry);
    return entry.id;
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

  appendLabelChange(targetId: string, label: string | undefined): string {
    if (!this.byId.has(targetId)) {
      throw new Error(`Entry ${targetId} not found`);
    }
    const entry: sessionManagerTypes.LabelEntry = {
      id: generateId(this.byId),
      label,
      parentId: this.leafId,
      targetId,
      timestamp: nowIso(),
      type: "label",
    };
    this.appendEntry(entry);
    if (label !== undefined && label !== "") {
      this.labelsById.set(targetId, label);
      this.labelTimestampsById.set(targetId, entry.timestamp);
    } else {
      this.labelsById.delete(targetId);
      this.labelTimestampsById.delete(targetId);
    }
    return entry.id;
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
}
