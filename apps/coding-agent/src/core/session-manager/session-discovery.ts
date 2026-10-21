import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import platformNode from "../platform-node.ts";
import nodeFsPromises from "../platform/node/fs-promises.ts";
import sessionManagerHelpers from "../session-manager-helpers.ts";
import type sessionManagerInternalTypes from "../session-manager-internal.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { join, basename } = platformNode;
const { readdir, stat } = nodeFsPromises;
const {
  ALL_SESSION_LIST_PUBLISH_INTERVAL,
  MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
  buildSessionInfosWithConcurrency,
  mapWithConcurrency,
  sortSessionInfos,
} = sessionManagerHelpers;

function* collectSessionCandidates(sessionsDir: string, abortSignal: AbortSignal | undefined) {
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

function* loadAllSessions(
  sessionsDir: string,
  progress: sessionManagerTypes.SessionListProgress | undefined,
  abortSignal: AbortSignal | undefined,
) {
  const candidates = yield* collectSessionCandidates(sessionsDir, abortSignal);
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
}

const sessionDiscovery = { loadAllSessions };

export default sessionDiscovery;
