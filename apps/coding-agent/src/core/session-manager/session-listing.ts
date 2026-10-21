import * as Effect from "effect/Effect";

import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import awaitingModule from "../awaiting.ts";
import platformModule from "../platform/index.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFiles from "./session-files.ts";
import sessionInfoLoading from "./session-info-loading.ts";
import sessionInfo from "./session-info.ts";

const { getSessionsDir } = config;
const { loadAllSessions, listSessionsFromDir } = sessionInfoLoading;
const { resolvePath, normalizePath } = paths;
const { awaited, awaiting, performed } = awaitingModule;
const { join } = platformModule;
const { exists, readDirectory } = platformModule.files;
const { sortSessionInfos } = sessionInfo;
const {
  getDefaultSessionDirPath,
  getSessionHeaderCwd,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
} = sessionFiles;

function findInFiles(options: {
  dir: string;
  files: readonly string[];
  id: string;
  resolvedCwd: string | undefined;
}): Promise<string | undefined> {
  const [file, ...rest] = options.files;
  if (file === undefined) return Promise.resolve(undefined);
  const searchRest = () => findInFiles({ ...options, files: rest });
  if (!file.endsWith(".jsonl")) return searchRest();
  const path = join(options.dir, file);
  return readSessionHeaderForDiscovery(path).then((header) =>
    header?.id === options.id &&
    (options.resolvedCwd === undefined ||
      sessionCwdMatches(getSessionHeaderCwd(header), options.resolvedCwd))
      ? path
      : searchRest(),
  );
}

function findById(cwd: string, id: string, sessionDir?: string): Promise<string | undefined> {
  const dir =
    sessionDir !== undefined && sessionDir !== ""
      ? normalizePath(sessionDir)
      : getDefaultSessionDirPath(cwd);
  const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
  return readDirectory(dir)
    .then((files) =>
      findInFiles({ dir, files, id, resolvedCwd: filterCwd ? resolvePath(cwd) : undefined }),
    )
    .catch(() => undefined);
}

function list(
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
          : getDefaultSessionDirPath(cwd);
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

function listAll(
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
        if (!(yield* awaited(exists(sessionsDir)))) return [];
        return yield* loadAllSessions(sessionsDir, progress, abortSignal);
      } catch {
        abortSignal?.throwIfAborted();
        return [];
      }
    }),
  );
}

const sessionListing = { findById, list, listAll };

export default sessionListing;
