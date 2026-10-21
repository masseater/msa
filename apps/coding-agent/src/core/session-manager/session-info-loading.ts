import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import platformNode from "../platform-node.ts";
import nodeFsPromises from "../platform/node/fs-promises.ts";
import nodeFs from "../platform/node/fs.ts";
import type sessionManagerInternalTypes from "../session-manager-internal.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionInfo from "./session-info.ts";

const { basename, join } = platformNode;
const { stat, readdir } = nodeFsPromises;
const { sortSessionInfos, buildSessionInfo } = sessionInfo;
const { existsSync } = nodeFs;
const { performed, awaited, awaiting } = awaitingModule;

const MAX_CONCURRENT_SESSION_INFO_LOADS = 10;

const MAX_CONCURRENT_SESSION_DISCOVERY_LOADS = 64;

const CURRENT_SESSION_LIST_PUBLISH_INTERVAL = 10;

const ALL_SESSION_LIST_PUBLISH_INTERVAL = 100;

function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Effect.Effect<R[]> {
  return awaiting(function* () {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const worker = (): Promise<void> =>
      Effect.runPromise(
        awaiting(function* () {
          while (nextIndex < items.length) {
            signal?.throwIfAborted();
            const index = nextIndex++;
            results[index] = yield* awaited(map(items[index]!, index));
          }
        }),
      );
    yield* awaited(
      Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker())),
    );
    return results;
  });
}

function buildSessionInfosWithConcurrency(
  files: sessionManagerInternalTypes.SessionFileCandidate[],
  onLoaded: (info: sessionManagerTypes.SessionInfo | null, index: number) => void,
  signal?: AbortSignal,
): Promise<(sessionManagerTypes.SessionInfo | null)[]> {
  return Effect.runPromise(
    mapWithConcurrency(
      files,
      MAX_CONCURRENT_SESSION_INFO_LOADS,
      (file, index) =>
        Effect.runPromise(
          awaiting(function* () {
            const info = yield* performed(buildSessionInfo(file.path, signal, file.stats));
            onLoaded(info, index);
            return info;
          }),
        ),
      signal,
    ),
  );
}

function listSessionsFromDir(
  dir: string,
  onProgress?: sessionManagerTypes.SessionListProgress,
  signal?: AbortSignal,
): Effect.Effect<sessionManagerTypes.SessionInfo[]> {
  return awaiting(function* () {
    signal?.throwIfAborted();
    if (!existsSync(dir)) return [];

    try {
      const dirEntries = yield* awaited(readdir(dir));
      const files = dirEntries
        .filter((file) => file.endsWith(".jsonl"))
        .sort((a, b) => b.localeCompare(a))
        .map((file) => ({ path: join(dir, file) }));
      const total = files.length;
      const partialSessions: sessionManagerTypes.SessionInfo[] = [];
      let loaded = 0;
      const results = yield* awaited(
        buildSessionInfosWithConcurrency(
          files,
          (info) => {
            loaded++;
            if (info !== null) partialSessions.push(info);
            const publishPartial =
              loaded === 1 ||
              loaded % CURRENT_SESSION_LIST_PUBLISH_INTERVAL === 0 ||
              loaded === files.length;
            onProgress?.(
              loaded,
              total,
              publishPartial ? sortSessionInfos([...partialSessions]) : undefined,
            );
          },
          signal,
        ),
      );
      return results.filter((info): info is sessionManagerTypes.SessionInfo => info !== null);
    } catch {
      signal?.throwIfAborted();
      return [];
    }
  });
}

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

const sessionInfoLoading = { listSessionsFromDir, loadAllSessions };

export default sessionInfoLoading;
