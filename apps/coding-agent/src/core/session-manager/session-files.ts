import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import platformModule from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";
import StringDecoder from "../platform/node/string-decoder.ts";
import SessionHeaderScanLimitError from "../session-header-scan-limit-error.ts";
import sessionManagerShared from "../session-manager-shared.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFormat from "./session-format.ts";

const {
  statSync,
  readdirSync,
  appendFileSync,
  closeSync,
  readSync,
  openSync,
  mkdirSync,
  existsSync,
} = nodeFs;
const { MAX_SESSION_HEADER_SCAN_BYTES } = sessionManagerShared;
const { normalizePath, resolvePath } = paths;
const { join } = platformModule;
const { getAgentDir: getDefaultAgentDir } = config;
const { parseSessionHeaderCandidate, parseSessionEntryLine } = sessionFormat;

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

function readSessionHeader(filePath: string): sessionManagerTypes.SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(SESSION_HEADER_READ_BUFFER_SIZE);
    const lineChunks: string[] = [];
    let scannedBytes = 0;

    while (scannedBytes < MAX_SESSION_HEADER_SCAN_BYTES) {
      const readLength = Math.min(buffer.length, MAX_SESSION_HEADER_SCAN_BYTES - scannedBytes);
      const bytesRead = readSync(fd, buffer, 0, readLength, null);
      if (bytesRead === 0) {
        lineChunks.push(decoder.end());
        return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
      }
      scannedBytes += bytesRead;

      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = chunk.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        lineChunks.push(chunk.slice(lineStart, newlineIndex));
        const header = parseSessionHeaderCandidate(lineChunks.join(""));
        if (header !== undefined) return header;
        lineChunks.length = 0;
        lineStart = newlineIndex + 1;
        newlineIndex = chunk.indexOf("\n", lineStart);
      }
      lineChunks.push(chunk.slice(lineStart));
    }

    const probe = Buffer.allocUnsafe(1);
    if (readSync(fd, probe, 0, probe.length, null) === 0) {
      lineChunks.push(decoder.end());
      return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
    }
    throw new SessionHeaderScanLimitError(filePath);
  } finally {
    closeSync(fd);
  }
}

function readSessionHeaderForDiscovery(filePath: string): sessionManagerTypes.SessionHeader | null {
  try {
    return readSessionHeader(filePath);
  } catch {
    return null;
  }
}

function getSessionHeaderCwd(header: sessionManagerTypes.SessionHeader): string | undefined {
  const cwd = (header as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : undefined;
}

function sessionCwdMatches(cwd: string | undefined, resolvedCwd: string): boolean {
  return cwd !== undefined && cwd !== "" && resolvePath(cwd) === resolvedCwd;
}

function findMostRecentSession(sessionDir: string, cwd?: string): string | null {
  const resolvedSessionDir = normalizePath(sessionDir);
  const resolvedCwd = cwd !== undefined && cwd !== "" ? resolvePath(cwd) : undefined;
  try {
    const files = readdirSync(resolvedSessionDir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => join(resolvedSessionDir, file))
      .map((path) => ({ mtime: statSync(path).mtimeMs, path }))
      .sort((a, b) => b.mtime - a.mtime);

    for (const { path } of files) {
      const header = readSessionHeaderForDiscovery(path);
      if (
        header !== null &&
        (resolvedCwd === undefined ||
          resolvedCwd === "" ||
          sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd))
      )
        return path;
    }
    return null;
  } catch {
    return null;
  }
}

const sessionFiles = {
  findMostRecentSession,
  getDefaultSessionDir,
  getDefaultSessionDirPath,
  getSessionHeaderCwd,
  loadEntriesFromFile,
  readSessionHeader,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
};

export default sessionFiles;
