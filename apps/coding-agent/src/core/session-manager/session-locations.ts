import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";
import SessionHeaderScanLimitError from "../session-header-scan-limit-error.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFiles from "./session-files.ts";
import sessionFormat from "./session-format.ts";

const { appendFileSync, writeFileSync, existsSync, mkdirSync } = nodeFs;
const {
  getDefaultSessionDirPath,
  loadEntriesFromFile,
  findMostRecentSession,
  getDefaultSessionDir,
  getSessionHeaderCwd,
  readSessionHeader,
} = sessionFiles;
const { CURRENT_SESSION_VERSION, assertValidSessionId, createSessionId } = sessionFormat;
const { join, nowIso, resolve } = platform;
const { resolvePath, normalizePath } = paths;

type SessionLocation = {
  cwd: string;
  dir: string;
  file: string | undefined;
  preloadedFileEntries?: sessionManagerTypes.FileEntry[] | undefined;
};

const sessionDirFor = (cwd: string, sessionDir: string | undefined): string =>
  sessionDir !== undefined && sessionDir !== ""
    ? normalizePath(sessionDir)
    : getDefaultSessionDir(cwd);

const locateExisting = (
  path: string,
  sessionDir: string | undefined,
  cwdOverride: string | undefined,
): SessionLocation => {
  const resolvedPath = resolvePath(path);
  let header: sessionManagerTypes.SessionHeader | null = null;
  let preloadedFileEntries: sessionManagerTypes.FileEntry[] | undefined;
  if (cwdOverride === undefined && existsSync(resolvedPath)) {
    try {
      header = readSessionHeader(resolvedPath);
    } catch (error) {
      if (!(error instanceof SessionHeaderScanLimitError)) throw error;
      preloadedFileEntries = loadEntriesFromFile(resolvedPath);
      const firstEntry = preloadedFileEntries[0];
      header = firstEntry?.type === "session" ? firstEntry : null;
    }
  }
  const cwd =
    cwdOverride ?? (header === null ? undefined : getSessionHeaderCwd(header)) ?? process.cwd();
  const dir =
    sessionDir !== undefined && sessionDir !== ""
      ? normalizePath(sessionDir)
      : resolve(resolvedPath, "..");
  return { cwd, dir, file: resolvedPath, preloadedFileEntries };
};

const locateRecent = (cwd: string, sessionDir: string | undefined): SessionLocation => {
  const dir = sessionDirFor(cwd, sessionDir);
  const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
  const mostRecent = findMostRecentSession(dir, filterCwd ? cwd : undefined);
  return { cwd, dir, file: mostRecent !== null && mostRecent !== "" ? mostRecent : undefined };
};

const readForkSource = (resolvedSourcePath: string) => {
  const sourceEntries = loadEntriesFromFile(resolvedSourcePath);
  if (sourceEntries.length === 0) {
    throw new Error(`Cannot fork: source session file is empty or invalid: ${resolvedSourcePath}`);
  }

  const sourceHeader = sourceEntries.find((e) => e.type === "session") as
    | sessionManagerTypes.SessionHeader
    | undefined;
  return { sourceEntries, sourceHeader };
};

const writeFork = (
  sourcePath: string,
  targetCwd: string,
  sessionDir: string | undefined,
  options: sessionManagerTypes.NewSessionOptions | undefined,
): SessionLocation => {
  const resolvedSourcePath = resolvePath(sourcePath);
  const resolvedTargetCwd = resolvePath(targetCwd);
  const { sourceHeader, sourceEntries } = readForkSource(resolvedSourcePath);
  if (sourceHeader === undefined) {
    throw new Error(`Cannot fork: source session has no header: ${resolvedSourcePath}`);
  }

  const dir = sessionDirFor(resolvedTargetCwd, sessionDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (options?.id !== undefined) {
    assertValidSessionId(options.id);
  }
  const newSessionId = options?.id ?? createSessionId();
  const timestamp = nowIso();
  const fileTimestamp = timestamp.replace(/[:.]/gu, "-");
  const newSessionFile = join(dir, `${fileTimestamp}_${newSessionId}.jsonl`);

  const newHeader: sessionManagerTypes.SessionHeader = {
    cwd: resolvedTargetCwd,
    id: newSessionId,
    parentSession: resolvedSourcePath,
    timestamp,
    type: "session",
    version: CURRENT_SESSION_VERSION,
  };
  writeFileSync(newSessionFile, `${JSON.stringify(newHeader)}\n`, { flag: "wx" });
  for (const entry of sourceEntries) {
    if (entry.type !== "session") {
      appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
    }
  }
  return { cwd: resolvedTargetCwd, dir, file: newSessionFile };
};

const sessionLocations = { locateExisting, locateRecent, sessionDirFor, writeFork };

export default sessionLocations;
