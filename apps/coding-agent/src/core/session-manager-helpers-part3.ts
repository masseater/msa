import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import platformNode from "./platform-node.ts";
import nodeFsPromises from "./platform/node/fs-promises.ts";
import nodeFs from "./platform/node/fs.ts";
import sessionManagerHelpersPart2 from "./session-manager-helpers-part2.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { awaited, awaiting } = awaitingModule;
const { existsSync } = nodeFs;
const { readdir } = nodeFsPromises;
const { join } = platformNode;
const {
  CURRENT_SESSION_LIST_PUBLISH_INTERVAL,
  buildSessionInfosWithConcurrency,
  sortSessionInfos,
} = sessionManagerHelpersPart2;

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

const sessionManagerHelpersPart3 = {
  listSessionsFromDir,
};

export default sessionManagerHelpersPart3;
