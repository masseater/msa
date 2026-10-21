import ai from "@msa/ai";

import platform from "../platform/index.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { uuidv7 } = ai;
const { randomUuid } = platform;

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

function createSessionId(): string {
  return uuidv7();
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

function parseSessionEntryLine(line: string): sessionManagerTypes.FileEntry | null {
  if (line.trim() === "") return null;
  try {
    return JSON.parse(line) as sessionManagerTypes.FileEntry;
  } catch {
    return null;
  }
}

function parseSessionHeaderCandidate(
  line: string,
): sessionManagerTypes.SessionHeader | null | undefined {
  if (line.trim() === "") return undefined;
  const entry = parseSessionEntryLine(line);
  if (entry === null) return undefined;
  if (entry.type !== "session" || typeof (entry as { id?: unknown }).id !== "string") return null;
  return entry;
}

const sessionFormat = {
  CURRENT_SESSION_VERSION,
  assertValidSessionId,
  createSessionId,
  generateId,
  migrateSessionEntries,
  migrateToCurrentVersion,
  parseSessionEntries,
  parseSessionEntryLine,
  parseSessionHeaderCandidate,
};

export default sessionFormat;
