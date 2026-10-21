import * as Effect from "effect/Effect";

import config from "../../config.ts";
import paths from "../../utils/paths.ts";
import awaitingModule from "../awaiting.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import sessionManagerHelpers from "../session-manager-helpers.ts";
import sessionManagerSupport from "../session-manager-support.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionDiscovery from "./session-discovery.ts";

const { getSessionsDir } = config;
const { loadAllSessions } = sessionDiscovery;
const { resolvePath, normalizePath } = paths;
const { awaiting, performed } = awaitingModule;
const { join } = platformNode;
const { existsSync, readdirSync } = nodeFs;
const { listSessionsFromDir, sortSessionInfos } = sessionManagerHelpers;
const {
  getDefaultSessionDirPath,
  getDefaultSessionDir,
  getSessionHeaderCwd,
  readSessionHeaderForDiscovery,
  sessionCwdMatches,
} = sessionManagerSupport;

function findById(cwd: string, id: string, sessionDir?: string): string | undefined {
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
        if (!existsSync(sessionsDir)) return [];
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
