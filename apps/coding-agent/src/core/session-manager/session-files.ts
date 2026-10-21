import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import platformModule from "../platform/index.ts";
import SessionHeaderScanLimitError from "../session-header-scan-limit-error.ts";
import type sessionManagerInternalTypes from "../session-manager-internal.types.ts";
import sessionManagerShared from "../session-manager-shared.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFormat from "./session-format.ts";

const { MAX_SESSION_HEADER_SCAN_BYTES } = sessionManagerShared;
const { normalizePath, resolvePath } = paths;
const { join } = platformModule;
const { appendText, exists, fileSize, foldLines, readDirectory, readHead, stat } =
  platformModule.files;
const { getAgentDir: getDefaultAgentDir } = config;
const { parseSessionHeaderCandidate, parseSessionEntryLine } = sessionFormat;

function getDefaultSessionDirPath(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolvedAgentDir, "sessions", safePath);
}

const SESSION_READ_BUFFER_SIZE = 1024 * 1024;

const SESSION_HEADER_QUICK_SCAN_BYTES = 64 * 1024;

const collectEntry = (
  entries: sessionManagerTypes.FileEntry[],
  line: string,
): sessionManagerTypes.FileEntry[] => {
  const entry = parseSessionEntryLine(line);
  if (entry !== null) entries.push(entry);
  return entries;
};

const hasValidHeader = (entries: sessionManagerTypes.FileEntry[]): boolean => {
  const header = entries[0];
  return header?.type === "session" && typeof (header as { id?: unknown }).id === "string";
};

function readEntries(resolvedFilePath: string): Promise<sessionManagerTypes.FileEntry[]> {
  return foldLines<sessionManagerTypes.FileEntry[]>({
    chunkSize: SESSION_READ_BUFFER_SIZE,
    initial: [],
    path: resolvedFilePath,
    step: collectEntry,
  }).then(({ state: entries, endsWithNewline }) => {
    if (entries.length === 0) return entries;
    if (!hasValidHeader(entries)) return [];
    return endsWithNewline
      ? entries
      : appendText({ data: "\n", path: resolvedFilePath }).then(() => entries);
  });
}

function loadEntriesFromFile(filePath: string): Promise<sessionManagerTypes.FileEntry[]> {
  const resolvedFilePath = normalizePath(filePath);
  return exists(resolvedFilePath).then((found) => (found ? readEntries(resolvedFilePath) : []));
}

function loadSessionFile(
  filePath: string,
  preloadedEntries?: sessionManagerTypes.FileEntry[],
): Promise<sessionManagerInternalTypes.LoadedSessionFile> {
  return exists(filePath).then((found) =>
    found
      ? Promise.all([preloadedEntries ?? readEntries(filePath), fileSize(filePath)]).then(
          ([entries, size]) => ({ entries, size }),
        )
      : null,
  );
}

const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function headerFromLines(
  text: string,
  complete: boolean,
): sessionManagerTypes.SessionHeader | null | undefined {
  const lines = text.split("\n");
  const last = lines.pop() ?? "";
  for (const line of lines) {
    const header = parseSessionHeaderCandidate(line);
    if (header !== undefined) return header;
  }
  return complete ? (parseSessionHeaderCandidate(last) ?? null) : undefined;
}

function readHeaderWithinLimit(
  filePath: string,
): Promise<sessionManagerTypes.SessionHeader | null> {
  return readHead({ length: MAX_SESSION_HEADER_SCAN_BYTES + 1, path: filePath }).then((head) => {
    const complete = head.length <= MAX_SESSION_HEADER_SCAN_BYTES;
    const header = headerFromLines(
      decodeText(head.subarray(0, MAX_SESSION_HEADER_SCAN_BYTES)),
      complete,
    );
    if (header !== undefined) return header;
    throw new SessionHeaderScanLimitError(filePath);
  });
}

function readSessionHeader(filePath: string): Promise<sessionManagerTypes.SessionHeader | null> {
  return readHead({ length: SESSION_HEADER_QUICK_SCAN_BYTES, path: filePath }).then((head) => {
    const header = headerFromLines(decodeText(head), head.length < SESSION_HEADER_QUICK_SCAN_BYTES);
    return header === undefined ? readHeaderWithinLimit(filePath) : header;
  });
}

function readSessionHeaderForDiscovery(
  filePath: string,
): Promise<sessionManagerTypes.SessionHeader | null> {
  return readSessionHeader(filePath).catch(() => null);
}

function getSessionHeaderCwd(header: sessionManagerTypes.SessionHeader): string | undefined {
  const cwd = (header as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : undefined;
}

function sessionCwdMatches(cwd: string | undefined, resolvedCwd: string): boolean {
  return cwd !== undefined && cwd !== "" && resolvePath(cwd) === resolvedCwd;
}

function sessionFilesByRecency(resolvedSessionDir: string): Promise<string[]> {
  return readDirectory(resolvedSessionDir)
    .then((files) =>
      Promise.all(
        files
          .filter((file) => file.endsWith(".jsonl"))
          .map((file) => join(resolvedSessionDir, file))
          .map((path) => stat(path).then((info) => ({ mtime: info.mtimeMs, path }))),
      ),
    )
    .then((files) => files.sort((a, b) => b.mtime - a.mtime).map(({ path }) => path));
}

function firstMatchingSession(
  candidates: string[],
  resolvedCwd: string | undefined,
): Promise<string | null> {
  const [path, ...rest] = candidates;
  if (path === undefined) return Promise.resolve(null);
  return readSessionHeaderForDiscovery(path).then((header) =>
    header !== null &&
    (resolvedCwd === undefined || sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd))
      ? path
      : firstMatchingSession(rest, resolvedCwd),
  );
}

function findMostRecentSession(sessionDir: string, cwd?: string): Promise<string | null> {
  const resolvedCwd = cwd !== undefined && cwd !== "" ? resolvePath(cwd) : undefined;
  return sessionFilesByRecency(normalizePath(sessionDir))
    .then((files) => firstMatchingSession(files, resolvedCwd))
    .catch(() => null);
}

const sessionFiles = {
  findMostRecentSession,
  getDefaultSessionDirPath,
  getSessionHeaderCwd,
  loadEntriesFromFile,
  loadSessionFile,
  readSessionHeader,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
};

export default sessionFiles;
