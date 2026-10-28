import type agentTypes from "@msa/agent-core/index.types";
import { isNullish } from "effect/Predicate";

import messagesModule from "../messages.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { createCompactionSummaryMessage, createBranchSummaryMessage, createCustomMessage } =
  messagesModule;

function getLatestCompactionEntry(
  entries: sessionManagerTypes.SessionEntry[],
): sessionManagerTypes.CompactionEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "compaction") {
      return entry;
    }
  }
  return null;
}

function buildEntryIndex(
  entries: sessionManagerTypes.SessionEntry[],
  byId?: Map<string, sessionManagerTypes.SessionEntry>,
): Map<string, sessionManagerTypes.SessionEntry> {
  if (byId !== undefined) return byId;
  const index = new Map<string, sessionManagerTypes.SessionEntry>();
  for (const entry of entries) {
    index.set(entry.id, entry);
  }
  return index;
}

function buildSessionPath(
  entries: sessionManagerTypes.SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, sessionManagerTypes.SessionEntry>,
): sessionManagerTypes.SessionEntry[] {
  const index = buildEntryIndex(entries, byId);
  let leaf: sessionManagerTypes.SessionEntry | undefined;
  if (leafId === null) {
    return [];
  }
  if (leafId !== undefined && leafId !== "") {
    leaf = index.get(leafId);
  }
  leaf ??= entries[entries.length - 1];
  if (leaf === undefined) {
    return [];
  }

  const path: sessionManagerTypes.SessionEntry[] = [];
  let current: sessionManagerTypes.SessionEntry | undefined = leaf;
  while (current !== undefined) {
    path.push(current);
    current =
      current.parentId !== null && current.parentId !== ""
        ? index.get(current.parentId)
        : undefined;
  }
  path.reverse();
  return path;
}

function getSessionContextSettings(
  path: sessionManagerTypes.SessionEntry[],
): Pick<sessionManagerTypes.SessionContext, "thinkingLevel" | "model"> {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;

  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { modelId: entry.modelId, provider: entry.provider };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      model = { modelId: entry.message.model, provider: entry.message.provider };
    }
  }

  return { model, thinkingLevel };
}

function sessionEntryToContextMessages(
  entry: sessionManagerTypes.SessionEntry,
): agentTypes.AgentMessage[] {
  if (entry.type === "message") {
    const message = entry.message;
    if (message.role === "system" && isNullish(message.content))
      return [{ ...message, content: "" }];
    if (
      (message.role === "user" || message.role === "assistant" || message.role === "toolResult") &&
      isNullish(message.content)
    ) {
      return [{ ...message, content: [] }];
    }
    return [message];
  }
  if (entry.type === "custom_message") {
    return [
      createCustomMessage(
        entry.customType,
        entry.content ?? [],
        entry.display,
        entry.details,
        entry.timestamp,
      ),
    ];
  }
  if (entry.type === "branch_summary" && entry.summary !== "") {
    return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
  }
  if (entry.type === "compaction") {
    const summary = createCompactionSummaryMessage(
      entry.summary,
      entry.tokensBefore,
      entry.timestamp,
    );
    return entry.systemMessage === undefined ? [summary] : [entry.systemMessage, summary];
  }
  return [];
}

function buildContextEntries(
  entries: sessionManagerTypes.SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, sessionManagerTypes.SessionEntry>,
): sessionManagerTypes.SessionEntry[] {
  const path = buildSessionPath(entries, leafId, byId);
  let compaction: sessionManagerTypes.CompactionEntry | null = null;

  for (const entry of path) {
    if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  if (compaction === null) {
    return path;
  }

  const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
  if (compactionIdx < 0) {
    return path;
  }

  const contextEntries: sessionManagerTypes.SessionEntry[] = [compaction];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    const entry = path[i];
    if (entry === undefined) continue;
    if (entry.id === compaction.firstKeptEntryId) {
      foundFirstKept = true;
    }
    if (foundFirstKept && !(entry.type === "message" && entry.message.role === "system")) {
      contextEntries.push(entry);
    }
  }
  contextEntries.push(...path.slice(compactionIdx + 1));
  return contextEntries;
}

function projectContextEntry(
  entry: sessionManagerTypes.SessionEntry,
  edit: sessionManagerTypes.ContextEditEntry | undefined,
): agentTypes.AgentMessage[] {
  const messages = sessionEntryToContextMessages(entry);
  if (edit === undefined) return messages;
  const replacement = edit.replacement;
  if (replacement === null) return [];

  return messages.map((message) => withEditedContent(message, replacement));
}

function withEditedContent(
  message: agentTypes.AgentMessage,
  replacement: NonNullable<sessionManagerTypes.ContextEditEntry["replacement"]>,
): agentTypes.AgentMessage {
  if (
    message.role !== "user" &&
    message.role !== "assistant" &&
    message.role !== "toolResult" &&
    message.role !== "custom"
  ) {
    return message;
  }
  const content =
    (message.role === "assistant" || message.role === "toolResult") &&
    typeof replacement.content === "string"
      ? [{ text: replacement.content, type: "text" as const }]
      : replacement.content;
  return { ...message, content } as agentTypes.AgentMessage;
}

function buildSessionProjection(
  entries: sessionManagerTypes.SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, sessionManagerTypes.SessionEntry>,
): sessionManagerTypes.SessionProjection {
  const path = buildSessionPath(entries, leafId, byId);
  const { thinkingLevel, model } = getSessionContextSettings(path);
  const contextEntries = buildContextEntries(entries, leafId, byId);
  const edits = new Map<string, sessionManagerTypes.ContextEditEntry>();
  for (const entry of contextEntries) {
    if (entry.type === "context_edit") edits.set(entry.targetId, entry);
  }
  const projectedEntries = contextEntries.map(
    (sourceEntry, index): sessionManagerTypes.ProjectedSessionEntry => ({
      messages:
        sourceEntry.type === "compaction" && index > 0
          ? []
          : projectContextEntry(sourceEntry, edits.get(sourceEntry.id)),
      sourceEntry,
    }),
  );
  return {
    entries: projectedEntries,
    messages: projectedEntries.flatMap((entry) => entry.messages),
    model,
    thinkingLevel,
  };
}

function buildSessionContext(
  entries: sessionManagerTypes.SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, sessionManagerTypes.SessionEntry>,
): sessionManagerTypes.SessionContext {
  const { messages, thinkingLevel, model } = buildSessionProjection(entries, leafId, byId);
  return { messages, model, thinkingLevel };
}

const sessionContext = {
  buildContextEntries,
  buildSessionContext,
  buildSessionProjection,
  getLatestCompactionEntry,
  sessionEntryToContextMessages,
};

export default sessionContext;
