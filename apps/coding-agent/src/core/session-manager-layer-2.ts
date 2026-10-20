import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type messagesTypes from "./messages.types.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import sessionManagerHelpers from "./session-manager-helpers.ts";
import SessionManagerLayer1 from "./session-manager-layer-1.ts";
import sessionManagerSupport from "./session-manager-support.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { CURRENT_SESSION_VERSION, assertValidSessionId, generateId, migrateToCurrentVersion } =
  sessionManagerSupport;
const { nowIso, toEpochMs } = platform;
const { join } = platformNode;
const { getCurrentSystemMessage } = ai;
const { createSessionId } = sessionManagerHelpers;

export default abstract class SessionManagerLayer2 extends SessionManagerLayer1 {
  newSession(options?: sessionManagerTypes.NewSessionOptions): string | undefined {
    if (options?.id !== undefined) {
      assertValidSessionId(options.id);
    }
    this.sessionId = options?.id ?? createSessionId();
    const timestamp = nowIso();
    const header: sessionManagerTypes.SessionHeader = {
      cwd: this.cwd,
      id: this.sessionId,
      parentSession: options?.parentSession,
      timestamp,
      type: "session",
      version: CURRENT_SESSION_VERSION,
    };
    this.fileEntries = [header];
    this.byId.clear();
    this.labelsById.clear();
    this.labelTimestampsById.clear();
    this.leafId = null;
    this.flushed = false;

    if (this.persist) {
      const fileTimestamp = timestamp.replace(/[:.]/gu, "-");
      this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
    }
    return this.sessionFile;
  }

  protected loadEntries(
    entries: sessionManagerTypes.FileEntry[],
    options?: sessionManagerTypes.NewSessionOptions,
  ): void {
    const header = entries.find((e) => e.type === "session") as
      | sessionManagerTypes.SessionHeader
      | undefined;

    if (header === undefined) {
      this.newSession(options);
      this.fileEntries = this.fileEntries.concat(entries);
    } else {
      this.fileEntries = entries;
      this.sessionId = header.id;

      if (migrateToCurrentVersion(this.fileEntries)) {
        this.rewriteFile();
      }
    }

    this.buildIndex();
  }

  appendMessage(
    message: aiTypes.Message | messagesTypes.CustomMessage | messagesTypes.BashExecutionMessage,
  ): string {
    const entry: sessionManagerTypes.SessionMessageEntry = {
      id: generateId(this.byId),
      message,
      parentId: this.leafId,
      timestamp: nowIso(),
      type: "message",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendUsage(
    kind: string,
    provider: string,
    model: string,
    usage: aiTypes.Usage,
    note?: string,
  ): sessionManagerTypes.UsageEntry {
    const entry: sessionManagerTypes.UsageEntry = {
      id: generateId(this.byId),
      kind,
      model,
      parentId: this.leafId,
      provider,
      timestamp: nowIso(),
      type: "usage",
      usage,
      ...(note !== undefined && note !== "" ? { note } : {}),
    };
    this.appendEntry(entry);
    return entry;
  }

  appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string | null,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean,
    usage?: aiTypes.Usage,
  ): string {
    const timestamp = nowIso();
    const systemMessage = getCurrentSystemMessage(this.buildSessionProjection().messages);
    const id = generateId(this.byId);
    const entry: sessionManagerTypes.CompactionEntry<T> = {
      details,
      firstKeptEntryId: firstKeptEntryId ?? id,
      fromHook,
      id,
      parentId: this.leafId,
      summary,
      timestamp,
      tokensBefore,
      type: "compaction",
      usage,
      ...(systemMessage === undefined
        ? {}
        : { systemMessage: { ...systemMessage, timestamp: toEpochMs(timestamp) } }),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (aiTypes.TextContent | aiTypes.ImageContent)[],
    display: boolean,
    details?: T,
  ): string {
    const entry: sessionManagerTypes.CustomMessageEntry<T> = {
      content,
      customType,
      details,
      display,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: nowIso(),
      type: "custom_message",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendContextEdit(
    targetId: string,
    replacement: sessionManagerTypes.ContextEditEntry["replacement"],
  ): string {
    if (
      replacement !== null &&
      (typeof replacement !== "object" ||
        !("content" in replacement) ||
        (typeof replacement.content !== "string" && !Array.isArray(replacement.content)))
    ) {
      throw new Error("Context edit replacement must be null or contain string/array content");
    }
    const target = this.byId.get(targetId);
    if (target === undefined) throw new Error(`Entry ${targetId} not found`);
    if (!this.getBranch().some((entry) => entry.id === targetId)) {
      throw new Error(`Entry ${targetId} is not on the active branch`);
    }
    const editable =
      target.type === "custom_message" ||
      (target.type === "message" &&
        (target.message.role === "user" ||
          target.message.role === "assistant" ||
          target.message.role === "toolResult"));
    if (!editable) throw new Error(`Entry ${targetId} does not contribute editable model content`);
    const targetRole = target.type === "message" ? target.message.role : "custom";
    const normalizedReplacement =
      replacement !== null &&
      (targetRole === "assistant" || targetRole === "toolResult") &&
      typeof replacement.content === "string"
        ? { content: [{ text: replacement.content, type: "text" as const }] }
        : replacement;
    const entry: sessionManagerTypes.ContextEditEntry = {
      id: generateId(this.byId),
      parentId: this.leafId,
      replacement: normalizedReplacement,
      targetId,
      timestamp: nowIso(),
      type: "context_edit",
    };
    this.appendEntry(entry);
    return entry.id;
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

  branchWithSummary(
    branchFromId: string | null,
    summary: string,
    details?: unknown,
    fromHook?: boolean,
    usage?: aiTypes.Usage,
  ): string {
    if (branchFromId !== null && !this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    const fromId = this.leafId ?? "root";
    this.leafId = branchFromId;
    const entry: sessionManagerTypes.BranchSummaryEntry = {
      details,
      fromHook,
      fromId,
      id: generateId(this.byId),
      parentId: branchFromId,
      summary,
      timestamp: nowIso(),
      type: "branch_summary",
      usage,
    };
    this.appendEntry(entry);
    return entry.id;
  }
}
