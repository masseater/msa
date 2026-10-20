import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import platform from "./platform.ts";
import nodeFsPromises from "./platform/node/fs-promises.ts";
import type nodeFsTypes from "./platform/node/fs.types.ts";
import sessionManagerHelpersPart1 from "./session-manager-helpers-part1.ts";
import type sessionManagerInternalTypes from "./session-manager-internal.types.ts";
import sessionManagerSupport from "./session-manager-support.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { stat } = nodeFsPromises;
const { parseSessionEntryLine } = sessionManagerSupport;
const { toDate, toEpochMs } = platform;
const { buildSessionInfoPart1, buildSessionInfoPart2, extractTextContent, isMessageWithContent } =
  sessionManagerHelpersPart1;

function buildSessionInfo(
  filePath: string,
  signal?: AbortSignal,
  fileStats?: nodeFsTypes.Stats,
): Effect.Effect<sessionManagerTypes.SessionInfo | null> {
  return awaiting(function* () {
    try {
      const stats = fileStats ?? (yield* awaited(stat(filePath)));
      let {
        lines,
        header,
        name,
        messageCount,
        lastActivityTime,
        allMessages,
        firstMessage,
      }: {
        lines: NodeJS.AsyncIterator<string, any, any>;
        header: sessionManagerTypes.SessionHeader | null;
        name: string | undefined;
        messageCount: number;
        lastActivityTime: number | undefined;
        allMessages: string[];
        firstMessage: string;
      } = buildSessionInfoPart1(filePath, signal);
      try {
        for (
          let next = yield* awaited(lines.next());
          next.done !== true;
          next = yield* awaited(lines.next())
        ) {
          const line = next.value;
          const entry = parseSessionEntryLine(line);
          if (entry === null) continue;

          if (header === null && entry.type === "session") {
            header = entry;
            continue;
          }
          if (header === null) return null;

          if (entry.type === "session_info") {
            name = entry.name?.trim() || undefined;
          }

          if (entry.type !== "message") continue;
          let message;
          ({ message, messageCount, lastActivityTime } = buildSessionInfoPart2(
            messageCount,
            entry,
            lastActivityTime,
          ));
          if (!isMessageWithContent(message)) continue;
          if (message.role !== "user" && message.role !== "assistant") continue;

          const textContent = extractTextContent(message);
          if (textContent === "") continue;

          allMessages.push(textContent);
          if (firstMessage === "" && message.role === "user") {
            firstMessage = textContent;
          }
        }
      } finally {
        yield* awaited(lines.return?.());
      }

      if (header === null) return null;

      const cwd = typeof header.cwd === "string" ? header.cwd : "";
      const parentSessionPath = header.parentSession;
      const headerTime = typeof header.timestamp === "string" ? toEpochMs(header.timestamp) : NaN;
      const modified =
        typeof lastActivityTime === "number" && lastActivityTime > 0
          ? toDate(lastActivityTime)
          : Number.isNaN(headerTime)
            ? stats.mtime
            : toDate(headerTime);

      return {
        allMessagesText: allMessages.join(" "),
        created: toDate(header.timestamp),
        cwd,
        firstMessage: firstMessage || "(no messages)",
        id: header.id,
        messageCount,
        modified,
        name,
        parentSessionPath,
        path: filePath,
      };
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  });
}

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

function sortSessionInfos(
  sessions: sessionManagerTypes.SessionInfo[],
): sessionManagerTypes.SessionInfo[] {
  return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
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

const sessionManagerHelpersPart2 = {
  ALL_SESSION_LIST_PUBLISH_INTERVAL,
  CURRENT_SESSION_LIST_PUBLISH_INTERVAL,
  MAX_CONCURRENT_SESSION_DISCOVERY_LOADS,
  MAX_CONCURRENT_SESSION_INFO_LOADS,
  buildSessionInfo,
  buildSessionInfosWithConcurrency,
  mapWithConcurrency,
  sortSessionInfos,
};

export default sessionManagerHelpersPart2;
