import { Schema } from "effect";

import paths from "../../utils/paths.ts";
import platform from "../platform/index.ts";
import SessionHeaderScanLimitError from "../session-header-scan-limit-error.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFiles from "./session-files.ts";
import sessionFormat from "./session-format.ts";

const {
  getDefaultSessionDirPath,
  loadEntriesFromFile,
  findMostRecentSession,
  getSessionHeaderCwd,
  readSessionHeader,
} = sessionFiles;
const { exists, makeDirectory, writeFile } = platform.files;
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
    : getDefaultSessionDirPath(cwd);

type ExistingHeader = {
  header: sessionManagerTypes.SessionHeader | null;
  preloadedFileEntries?: sessionManagerTypes.FileEntry[] | undefined;
};

const readExistingHeader = (resolvedPath: string): Promise<ExistingHeader> =>
  readSessionHeader(resolvedPath).then(
    (header) => ({ header }),
    (error: unknown) => {
      if (!Schema.is(SessionHeaderScanLimitError)(error)) throw error;
      return loadEntriesFromFile(resolvedPath).then((preloadedFileEntries) => {
        const firstEntry = preloadedFileEntries[0];
        return {
          header: firstEntry?.type === "session" ? firstEntry : null,
          preloadedFileEntries,
        };
      });
    },
  );

const existingHeader = (
  resolvedPath: string,
  cwdOverride: string | undefined,
): Promise<ExistingHeader> =>
  cwdOverride === undefined
    ? exists(resolvedPath).then((found) =>
        found ? readExistingHeader(resolvedPath) : { header: null },
      )
    : Promise.resolve({ header: null });

const locateExisting = (
  path: string,
  sessionDir: string | undefined,
  cwdOverride: string | undefined,
): Promise<SessionLocation> => {
  const resolvedPath = resolvePath(path);
  return existingHeader(resolvedPath, cwdOverride).then(({ header, preloadedFileEntries }) => ({
    cwd:
      cwdOverride ?? (header === null ? undefined : getSessionHeaderCwd(header)) ?? process.cwd(),
    dir:
      sessionDir !== undefined && sessionDir !== ""
        ? normalizePath(sessionDir)
        : resolve(resolvedPath, ".."),
    file: resolvedPath,
    preloadedFileEntries,
  }));
};

const locateRecent = (cwd: string, sessionDir: string | undefined): Promise<SessionLocation> => {
  const dir = sessionDirFor(cwd, sessionDir);
  const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
  return findMostRecentSession(dir, filterCwd ? cwd : undefined).then((mostRecent) => ({
    cwd,
    dir,
    file: mostRecent !== null && mostRecent !== "" ? mostRecent : undefined,
  }));
};

const readForkSource = (resolvedSourcePath: string) =>
  loadEntriesFromFile(resolvedSourcePath).then((sourceEntries) => {
    if (sourceEntries.length === 0) {
      throw new Error(
        `Cannot fork: source session file is empty or invalid: ${resolvedSourcePath}`,
      );
    }
    const sourceHeader = sourceEntries.find((e) => e.type === "session") as
      | sessionManagerTypes.SessionHeader
      | undefined;
    return { sourceEntries, sourceHeader };
  });

const forkHeader = (options: {
  resolvedSourcePath: string;
  resolvedTargetCwd: string;
  newSessionOptions: sessionManagerTypes.NewSessionOptions | undefined;
}): sessionManagerTypes.SessionHeader => {
  if (options.newSessionOptions?.id !== undefined) {
    assertValidSessionId(options.newSessionOptions.id);
  }
  return {
    cwd: options.resolvedTargetCwd,
    id: options.newSessionOptions?.id ?? createSessionId(),
    parentSession: options.resolvedSourcePath,
    timestamp: nowIso(),
    type: "session",
    version: CURRENT_SESSION_VERSION,
  };
};

const writeFork = (
  sourcePath: string,
  targetCwd: string,
  sessionDir: string | undefined,
  options: sessionManagerTypes.NewSessionOptions | undefined,
): Promise<SessionLocation> => {
  const resolvedSourcePath = resolvePath(sourcePath);
  const resolvedTargetCwd = resolvePath(targetCwd);
  return readForkSource(resolvedSourcePath).then(({ sourceHeader, sourceEntries }) => {
    if (sourceHeader === undefined) {
      throw new Error(`Cannot fork: source session has no header: ${resolvedSourcePath}`);
    }
    const dir = sessionDirFor(resolvedTargetCwd, sessionDir);
    const newHeader = forkHeader({
      newSessionOptions: options,
      resolvedSourcePath,
      resolvedTargetCwd,
    });
    const fileTimestamp = newHeader.timestamp.replace(/[:.]/gu, "-");
    const newSessionFile = join(dir, `${fileTimestamp}_${newHeader.id}.jsonl`);
    const data = [newHeader, ...sourceEntries.filter((entry) => entry.type !== "session")]
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join("");
    return makeDirectory({ path: dir })
      .then(() => writeFile({ data, flag: "wx", path: newSessionFile }))
      .then(() => ({ cwd: resolvedTargetCwd, dir, file: newSessionFile }));
  });
};

const sessionLocations = { locateExisting, locateRecent, sessionDirFor, writeFork };

export default sessionLocations;
