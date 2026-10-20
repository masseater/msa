import * as Effect from "effect/Effect";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import awaitingModule from "./awaiting.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import nodeFsPromises from "./platform/node/fs-promises.ts";
import nodeFs from "./platform/node/fs.ts";
import SessionHeaderScanLimitError from "./session-header-scan-limit-error.ts";
import sessionManagerHelpers from "./session-manager-helpers.ts";
import type sessionManagerInternalTypes from "./session-manager-internal.types.ts";
import SessionManagerLayer3 from "./session-manager-layer-3.ts";
import sessionManagerSupport from "./session-manager-support.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { normalizePath, resolvePath } = paths;
const { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } = nodeFs;
const {
  CURRENT_SESSION_VERSION,
  assertValidSessionId,
  findMostRecentSession,
  getDefaultSessionDir,
  getDefaultSessionDirPath,
  getSessionHeaderCwd,
  loadEntriesFromFile,
  readSessionHeader,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
} = sessionManagerSupport;
const { basename, join, resolve } = platformNode;
const { nowIso } = platform;
const { awaited, awaiting, performed } = awaitingModule;
const { getSessionsDir } = config;
const { readdir, stat } = nodeFsPromises;
const {
  ALL_SESSION_LIST_PUBLISH_INTERVAL,
  MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
  buildSessionInfosWithConcurrency,
  createSessionId,
  listSessionsFromDir,
  mapWithConcurrency,
  sortSessionInfos,
} = sessionManagerHelpers;

export default class SessionManager extends SessionManagerLayer3 {
  static create(
    cwd: string,
    sessionDir?: string,
    options?: sessionManagerTypes.NewSessionOptions,
  ): SessionManager {
    const dir =
      sessionDir !== undefined && sessionDir !== ""
        ? normalizePath(sessionDir)
        : getDefaultSessionDir(cwd);
    return new SessionManager(cwd, dir, undefined, true, options);
  }

  static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager {
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
    return new SessionManager(cwd, dir, resolvedPath, true, undefined, preloadedFileEntries);
  }

  static continueRecent(cwd: string, sessionDir?: string): SessionManager {
    const dir =
      sessionDir !== undefined && sessionDir !== ""
        ? normalizePath(sessionDir)
        : getDefaultSessionDir(cwd);
    const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
    const mostRecent = findMostRecentSession(dir, filterCwd ? cwd : undefined);
    if (mostRecent !== null && mostRecent !== "") {
      return new SessionManager(cwd, dir, mostRecent, true);
    }
    return new SessionManager(cwd, dir, undefined, true);
  }

  static inMemory(
    cwd: string = process.cwd(),
    options?: sessionManagerTypes.NewSessionOptions,
    entries?: sessionManagerTypes.FileEntry[],
  ): SessionManager {
    return new SessionManager(cwd, "", undefined, false, options, entries);
  }

  static forkFrom(
    sourcePath: string,
    targetCwd: string,
    sessionDir?: string,
    options?: sessionManagerTypes.NewSessionOptions,
  ): SessionManager {
    const resolvedSourcePath = resolvePath(sourcePath);
    const resolvedTargetCwd = resolvePath(targetCwd);
    const { sourceHeader, sourceEntries } = SessionManager.forkFromPart1(resolvedSourcePath);
    if (sourceHeader === undefined) {
      throw new Error(`Cannot fork: source session has no header: ${resolvedSourcePath}`);
    }

    const dir =
      sessionDir !== undefined && sessionDir !== ""
        ? normalizePath(sessionDir)
        : getDefaultSessionDir(resolvedTargetCwd);
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

    return new SessionManager(resolvedTargetCwd, dir, newSessionFile, true);
  }

  static forkFromPart1(resolvedSourcePath: string) {
    const sourceEntries = loadEntriesFromFile(resolvedSourcePath);
    if (sourceEntries.length === 0) {
      throw new Error(
        `Cannot fork: source session file is empty or invalid: ${resolvedSourcePath}`,
      );
    }

    const sourceHeader = sourceEntries.find((e) => e.type === "session") as
      | sessionManagerTypes.SessionHeader
      | undefined;
    return { sourceEntries, sourceHeader };
  }

  static findById(cwd: string, id: string, sessionDir?: string): string | undefined {
    const dir =
      sessionDir !== undefined && sessionDir !== ""
        ? normalizePath(sessionDir)
        : getDefaultSessionDir(cwd);
    const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
    const resolvedCwd = resolvePath(cwd);

    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".jsonl")) continue;
        const path = join(dir, file);
        const header = readSessionHeaderForDiscovery(path);
        if (header?.id !== id) continue;
        if (filterCwd && !sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd)) continue;
        return path;
      }
    } catch {}
    return undefined;
  }

  static list(
    cwd: string,
    sessionDir?: string,
    onProgress?: sessionManagerTypes.SessionListProgress,
    signal?: AbortSignal,
  ): Promise<sessionManagerTypes.SessionInfo[]> {
    return Effect.runPromise(
      awaiting(function* () {
        const dir =
          sessionDir !== undefined && sessionDir !== ""
            ? normalizePath(sessionDir)
            : getDefaultSessionDir(cwd);
        const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
        const resolvedCwd = resolvePath(cwd);
        const includeSession = (session: sessionManagerTypes.SessionInfo) =>
          !filterCwd || sessionCwdMatches(session.cwd, resolvedCwd);
        const progress: sessionManagerTypes.SessionListProgress | undefined =
          onProgress === undefined
            ? undefined
            : (loaded, total, partialSessions) =>
                onProgress(loaded, total, partialSessions?.filter(includeSession));
        const sessions = (yield* performed(listSessionsFromDir(dir, progress, signal))).filter(
          includeSession,
        );
        return sortSessionInfos(sessions);
      }),
    );
  }

  static listAll(
    onProgress?: sessionManagerTypes.SessionListProgress,
    signal?: AbortSignal,
  ): Promise<sessionManagerTypes.SessionInfo[]>;

  static listAll(
    sessionDir?: string,
    onProgress?: sessionManagerTypes.SessionListProgress,
    signal?: AbortSignal,
  ): Promise<sessionManagerTypes.SessionInfo[]>;

  static listAll(
    sessionDirOrOnProgress?: string | sessionManagerTypes.SessionListProgress,
    onProgressOrSignal?: sessionManagerTypes.SessionListProgress | AbortSignal,
    signal?: AbortSignal,
  ): Promise<sessionManagerTypes.SessionInfo[]> {
    return Effect.runPromise(
      awaiting(function* () {
        const customSessionDir =
          typeof sessionDirOrOnProgress === "string"
            ? normalizePath(sessionDirOrOnProgress)
            : undefined;
        const progress =
          typeof sessionDirOrOnProgress === "function"
            ? sessionDirOrOnProgress
            : typeof onProgressOrSignal === "function"
              ? onProgressOrSignal
              : undefined;
        const abortSignal =
          typeof sessionDirOrOnProgress === "string" || typeof onProgressOrSignal === "function"
            ? signal
            : (onProgressOrSignal ?? signal);
        abortSignal?.throwIfAborted();
        if (customSessionDir !== undefined && customSessionDir !== "") {
          return sortSessionInfos(
            yield* performed(listSessionsFromDir(customSessionDir, progress, abortSignal)),
          );
        }

        const sessionsDir = getSessionsDir();

        try {
          if (!existsSync(sessionsDir)) return [];
          const candidates = yield* SessionManager.listAllPart1(sessionsDir, abortSignal);
          candidates.sort(
            (a, b) =>
              (b.stats?.mtimeMs ?? Number.NEGATIVE_INFINITY) -
                (a.stats?.mtimeMs ?? Number.NEGATIVE_INFINITY) ||
              basename(b.path).localeCompare(basename(a.path)),
          );

          const totalFiles = candidates.length;
          let loaded = 0;
          let firstCandidateLoaded = false;
          const partialSessions: sessionManagerTypes.SessionInfo[] = [];
          const results = yield* awaited(
            buildSessionInfosWithConcurrency(
              candidates,
              (info, index) => {
                loaded++;
                if (index === 0) firstCandidateLoaded = true;
                if (info !== null) partialSessions.push(info);
                const publishPartial =
                  firstCandidateLoaded &&
                  (index === 0 ||
                    loaded % ALL_SESSION_LIST_PUBLISH_INTERVAL === 0 ||
                    loaded === totalFiles);
                progress?.(
                  loaded,
                  totalFiles,
                  publishPartial ? sortSessionInfos([...partialSessions]) : undefined,
                );
              },
              abortSignal,
            ),
          );

          return sortSessionInfos(
            results.filter((info): info is sessionManagerTypes.SessionInfo => info !== null),
          );
        } catch {
          abortSignal?.throwIfAborted();
          return [];
        }
      }),
    );
  }

  static *listAllPart1(sessionsDir: string, abortSignal: AbortSignal | undefined) {
    const entries = yield* awaited(readdir(sessionsDir, { withFileTypes: true }));
    const dirs = entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(sessionsDir, entry.name));

    const dirFiles = yield* performed(
      mapWithConcurrency(
        dirs,
        MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
        (dir) =>
          Effect.runPromise(
            awaiting(function* () {
              try {
                return (yield* awaited(readdir(dir)))
                  .filter((file) => file.endsWith(".jsonl"))
                  .map((file) => join(dir, file));
              } catch {
                return [];
              }
            }),
          ),
        abortSignal,
      ),
    );
    const allFiles = dirFiles.flat();
    const candidates = yield* performed(
      mapWithConcurrency(
        allFiles,
        MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
        (path): Promise<sessionManagerInternalTypes.SessionFileCandidate> =>
          Effect.runPromise(
            awaiting(function* () {
              try {
                return { path, stats: yield* awaited(stat(path)) };
              } catch {
                return { path };
              }
            }),
          ),
        abortSignal,
      ),
    );
    return candidates;
  }

  protected constructor(
    cwd: string,
    sessionDir: string,
    sessionFile: string | undefined,
    persist: boolean,
    newSessionOptions?: sessionManagerTypes.NewSessionOptions,
    preloadedFileEntries?: sessionManagerTypes.FileEntry[],
  ) {
    super();
    this.cwd = resolvePath(cwd);
    this.sessionDir = normalizePath(sessionDir);
    this.persist = persist;
    if (persist && this.sessionDir !== "" && !existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    if (sessionFile !== undefined && sessionFile !== "") {
      this.setSessionFileInternal(sessionFile, preloadedFileEntries);
    } else if (preloadedFileEntries?.length !== undefined && preloadedFileEntries?.length !== 0) {
      this.loadEntries(preloadedFileEntries, newSessionOptions);
    } else {
      this.newSession(newSessionOptions);
    }
  }
}
