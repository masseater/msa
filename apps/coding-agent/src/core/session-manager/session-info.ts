import { createInterface } from "readline";

import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import nodeFsPromises from "../platform/node/fs-promises.ts";
import nodeFs from "../platform/node/fs.ts";
import type nodeFsTypes from "../platform/node/fs.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import sessionFormat from "./session-format.ts";
import SessionInfoScan from "./session-info-scan.ts";

const { stat } = nodeFsPromises;
const { awaited, awaiting } = awaitingModule;
const { createReadStream } = nodeFs;
const { parseSessionEntryLine } = sessionFormat;

function* scanSessionFile(filePath: string, signal: AbortSignal | undefined) {
  const scan = new SessionInfoScan();
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: "utf8", signal }),
  })[Symbol.asyncIterator]();
  try {
    for (
      let next = yield* awaited(lines.next());
      next.done !== true;
      next = yield* awaited(lines.next())
    ) {
      const entry = parseSessionEntryLine(next.value);
      if (entry !== null && !scan.add(entry)) return undefined;
    }
  } finally {
    yield* awaited(lines.return?.());
  }
  return scan;
}

function buildSessionInfo(
  filePath: string,
  signal?: AbortSignal,
  fileStats?: nodeFsTypes.Stats,
): Effect.Effect<sessionManagerTypes.SessionInfo | null> {
  return awaiting(function* () {
    try {
      const stats = fileStats ?? (yield* awaited(stat(filePath)));
      const scan = yield* scanSessionFile(filePath, signal);
      return scan === undefined ? null : scan.toInfo(filePath, stats);
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  });
}

function sortSessionInfos(
  sessions: sessionManagerTypes.SessionInfo[],
): sessionManagerTypes.SessionInfo[] {
  return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

const sessionInfo = { buildSessionInfo, sortSessionInfos };

export default sessionInfo;
