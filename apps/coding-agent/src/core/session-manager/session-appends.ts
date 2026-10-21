import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type messagesTypes from "../messages.types.ts";
import platform from "../platform.ts";
import sessionManagerSupport from "../session-manager-support.ts";
import type SessionManager from "../session-manager.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { generateId } = sessionManagerSupport;
const { nowIso, toEpochMs } = platform;
const { getCurrentSystemMessage } = ai;

export default class SessionAppends {
  private readonly manager: SessionManager;

  constructor(manager: SessionManager) {
    this.manager = manager;
  }

  private appendEntry(entry: sessionManagerTypes.SessionEntry): void {
    this.manager.tree.fileEntries.push(entry);
    this.manager.tree.byId.set(entry.id, entry);
    this.manager.tree.leafId = entry.id;
    this.manager.storage.persistInternal(entry);
  }

  appendThinkingLevelChange(thinkingLevel: string): string {
    const entry: sessionManagerTypes.ThinkingLevelChangeEntry = {
      id: generateId(this.manager.tree.byId),
      parentId: this.manager.tree.leafId,
      thinkingLevel,
      timestamp: nowIso(),
      type: "thinking_level_change",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendModelChange(provider: string, modelId: string): string {
    const entry: sessionManagerTypes.ModelChangeEntry = {
      id: generateId(this.manager.tree.byId),
      modelId,
      parentId: this.manager.tree.leafId,
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
      id: generateId(this.manager.tree.byId),
      parentId: this.manager.tree.leafId,
      timestamp: nowIso(),
      type: "custom",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendSessionInfo(name: string): string {
    const sanitizedName = name.replace(/[\r\n]+/gu, " ").trim();
    const entry: sessionManagerTypes.SessionInfoEntry = {
      id: generateId(this.manager.tree.byId),
      name: sanitizedName,
      parentId: this.manager.tree.leafId,
      timestamp: nowIso(),
      type: "session_info",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendLabelChange(targetId: string, label: string | undefined): string {
    if (!this.manager.tree.byId.has(targetId)) {
      throw new Error(`Entry ${targetId} not found`);
    }
    const entry: sessionManagerTypes.LabelEntry = {
      id: generateId(this.manager.tree.byId),
      label,
      parentId: this.manager.tree.leafId,
      targetId,
      timestamp: nowIso(),
      type: "label",
    };
    this.appendEntry(entry);
    if (label !== undefined && label !== "") {
      this.manager.tree.labelsById.set(targetId, label);
      this.manager.tree.labelTimestampsById.set(targetId, entry.timestamp);
    } else {
      this.manager.tree.labelsById.delete(targetId);
      this.manager.tree.labelTimestampsById.delete(targetId);
    }
    return entry.id;
  }

  appendMessage(
    message: aiTypes.Message | messagesTypes.CustomMessage | messagesTypes.BashExecutionMessage,
  ): string {
    const entry: sessionManagerTypes.SessionMessageEntry = {
      id: generateId(this.manager.tree.byId),
      message,
      parentId: this.manager.tree.leafId,
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
      id: generateId(this.manager.tree.byId),
      kind,
      model,
      parentId: this.manager.tree.leafId,
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
    const systemMessage = getCurrentSystemMessage(
      this.manager.tree.buildSessionProjection().messages,
    );
    const id = generateId(this.manager.tree.byId);
    const entry: sessionManagerTypes.CompactionEntry<T> = {
      details,
      firstKeptEntryId: firstKeptEntryId ?? id,
      fromHook,
      id,
      parentId: this.manager.tree.leafId,
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
      id: generateId(this.manager.tree.byId),
      parentId: this.manager.tree.leafId,
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
    const target = this.manager.tree.byId.get(targetId);
    if (target === undefined) throw new Error(`Entry ${targetId} not found`);
    if (!this.manager.tree.getBranch().some((entry) => entry.id === targetId)) {
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
      id: generateId(this.manager.tree.byId),
      parentId: this.manager.tree.leafId,
      replacement: normalizedReplacement,
      targetId,
      timestamp: nowIso(),
      type: "context_edit",
    };
    this.appendEntry(entry);
    return entry.id;
  }

  branchWithSummary(
    branchFromId: string | null,
    summary: string,
    details?: unknown,
    fromHook?: boolean,
    usage?: aiTypes.Usage,
  ): string {
    if (branchFromId !== null && !this.manager.tree.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    const fromId = this.manager.tree.leafId ?? "root";
    this.manager.tree.leafId = branchFromId;
    const entry: sessionManagerTypes.BranchSummaryEntry = {
      details,
      fromHook,
      fromId,
      id: generateId(this.manager.tree.byId),
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
