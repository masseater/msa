import { StringDecoder } from "string_decoder";

import type agentTypes from "@msa/agent-core/index.types";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import sessionManagerSupportPart1 from "./session-manager-support-part1.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { getAgentDir: getDefaultAgentDir } = config;
const { normalizePath, resolvePath } = paths;
const { join } = platformNode;
const { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync } = nodeFs;
const {
  buildContextEntries,
  buildSessionPath,
  getSessionContextSettings,
  sessionEntryToContextMessages,
} = sessionManagerSupportPart1;

function projectContextEntry(
  entry: sessionManagerTypes.SessionEntry,
  edit: sessionManagerTypes.ContextEditEntry | undefined,
): agentTypes.AgentMessage[] {
  const messages = sessionEntryToContextMessages(entry);
  if (edit === undefined) return messages;
  const replacement = edit.replacement;
  if (replacement === null) return [];

  return messages.map((message) => {
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
    return Object.assign({}, message, { content }) as agentTypes.AgentMessage;
  });
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

function getDefaultSessionDirPath(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolvedAgentDir, "sessions", safePath);
}

function getDefaultSessionDir(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const sessionDir = getDefaultSessionDirPath(cwd, agentDir);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

const SESSION_READ_BUFFER_SIZE = 1024 * 1024;

const SESSION_HEADER_READ_BUFFER_SIZE = 4096;

function parseSessionEntryLine(line: string): sessionManagerTypes.FileEntry | null {
  if (line.trim() === "") return null;
  try {
    return JSON.parse(line) as sessionManagerTypes.FileEntry;
  } catch {
    return null;
  }
}

function loadEntriesFromFile(filePath: string): sessionManagerTypes.FileEntry[] {
  const resolvedFilePath = normalizePath(filePath);
  if (!existsSync(resolvedFilePath)) return [];

  const entries: sessionManagerTypes.FileEntry[] = [];
  let pending = "";
  const fd = openSync(resolvedFilePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);

    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;

      pending += decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = pending.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        const entry = parseSessionEntryLine(pending.slice(lineStart, newlineIndex));
        if (entry !== null) entries.push(entry);
        lineStart = newlineIndex + 1;
        newlineIndex = pending.indexOf("\n", lineStart);
      }
      pending = pending.slice(lineStart);
    }

    pending += decoder.end();
    const finalEntry = parseSessionEntryLine(pending);
    if (finalEntry !== null) entries.push(finalEntry);
  } finally {
    closeSync(fd);
  }

  const header = entries[0];
  if (header === undefined) return entries;
  if (header.type !== "session" || typeof (header as { id?: unknown }).id !== "string") {
    return [];
  }

  if (pending !== "") appendFileSync(resolvedFilePath, "\n");
  return entries;
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

const sessionManagerSupportPart2 = {
  SESSION_HEADER_READ_BUFFER_SIZE,
  buildSessionContext,
  buildSessionProjection,
  getDefaultSessionDir,
  getDefaultSessionDirPath,
  loadEntriesFromFile,
  parseSessionEntryLine,
  parseSessionHeaderCandidate,
};

export default sessionManagerSupportPart2;
