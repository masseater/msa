import type agentTypes from "@msa/agent-core/index.types";
import { isNullish } from "effect/Predicate";

import messagesModule from "./messages.ts";
import platformNode from "./platform-node.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { randomUuid } = platformNode;
const { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } =
  messagesModule;

const CURRENT_SESSION_VERSION = 3;

function assertValidSessionId(id: string): void {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(id)) {
    throw new Error(
      "Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character",
    );
  }
}

function generateId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUuid().slice(0, 8);
    if (!byId.has(id)) return id;
  }
  return randomUuid();
}

function migrateV1ToV2(entries: sessionManagerTypes.FileEntry[]): void {
  const ids = new Set<string>();
  let prevId: string | null = null;

  for (const entry of entries) {
    if (entry.type === "session") {
      entry.version = 2;
      continue;
    }

    entry.id = generateId(ids);
    entry.parentId = prevId;
    prevId = entry.id;

    if (entry.type === "compaction") {
      const comp = entry as sessionManagerTypes.CompactionEntry & { firstKeptEntryIndex?: number };
      if (typeof comp.firstKeptEntryIndex === "number") {
        const targetEntry = entries[comp.firstKeptEntryIndex];
        if (targetEntry !== undefined && targetEntry.type !== "session") {
          comp.firstKeptEntryId = targetEntry.id;
        }
        delete comp.firstKeptEntryIndex;
      }
    }
  }
}

function migrateV2ToV3(entries: sessionManagerTypes.FileEntry[]): void {
  for (const entry of entries) {
    if (entry.type === "session") {
      entry.version = 3;
      continue;
    }

    if (entry.type === "message") {
      const msgEntry = entry as sessionManagerTypes.SessionMessageEntry;
      if ((msgEntry.message as { role: string }).role === "hookMessage") {
        (msgEntry.message as { role: string }).role = "custom";
      }
    }
  }
}

function migrateToCurrentVersion(entries: sessionManagerTypes.FileEntry[]): boolean {
  const header = entries.find((e) => e.type === "session") as
    | sessionManagerTypes.SessionHeader
    | undefined;
  const version = header?.version ?? 1;

  if (version >= CURRENT_SESSION_VERSION) return false;

  if (version < 2) migrateV1ToV2(entries);
  if (version < 3) migrateV2ToV3(entries);

  return true;
}

function migrateSessionEntries(entries: sessionManagerTypes.FileEntry[]): void {
  migrateToCurrentVersion(entries);
}

function parseSessionEntries(content: string): sessionManagerTypes.FileEntry[] {
  const entries: sessionManagerTypes.FileEntry[] = [];
  const lines = content.trim().split("\n");

  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line) as sessionManagerTypes.FileEntry;
      entries.push(entry);
    } catch {}
  }

  return entries;
}

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

const sessionManagerSupportPart1 = {
  CURRENT_SESSION_VERSION,
  assertValidSessionId,
  buildContextEntries,
  buildSessionPath,
  generateId,
  getLatestCompactionEntry,
  getSessionContextSettings,
  migrateSessionEntries,
  migrateToCurrentVersion,
  parseSessionEntries,
  sessionEntryToContextMessages,
};

export default sessionManagerSupportPart1;
