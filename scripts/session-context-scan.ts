import { DateTime, Effect, Option, Result, Stream } from "effect";

import type { HostShape } from "./host.ts";
import { bashCommandsOf, contextTokens, decodeContextEntry } from "./session-context-entry.ts";
import type { ContextEntry, ContextMessage } from "./session-context-entry.ts";
import type { ContextWindows } from "./session-context-windows.ts";
import { jsonlFilesRecursive } from "./sessions.ts";

const FILE_TIMESTAMP = /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u;

interface SessionRecord {
  sessionFile: string;
  cwd: string | null;
  startMs: number;
  endMs: number;
  providerModel: string;
  assistantMessages: number;
  userMessages: number;
  compactions: number;
  seenCompaction: boolean;
  maxPromptTokens: number | null;
  preFirstCompactionTokens: number | null;
  maxContextUsagePercent: number | null;
  preFirstCompactionUsagePercent: number | null;
  contextWindow: number | null;
  bashCommands: Array<string>;
  over80: boolean;
  over90: boolean;
  over100: boolean;
}

interface ScanMeta {
  sessionsDir: string;
  sessionFilesScanned: number;
  sessionFilesIncluded: number;
  sessionFilesSkippedOlderThanSince: number;
  malformedLines: number;
}

const parseMillis = (value: string): number | null => {
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.toEpochMillis(parsed.value) : null;
};

const sessionFileMillis = (host: HostShape, sessionFile: string): number | null => {
  const raw = host.basename(sessionFile).split("_")[0];
  if (raw === undefined || raw === "") return null;
  return parseMillis(raw.replace(FILE_TIMESTAMP, "T$1:$2:$3.$4Z"));
};

const emptySession = (sessionFile: string, fileMillis: number | null): SessionRecord => ({
  sessionFile,
  cwd: null,
  startMs: fileMillis ?? 0,
  endMs: fileMillis ?? 0,
  providerModel: "[unknown]/[unknown]",
  assistantMessages: 0,
  userMessages: 0,
  compactions: 0,
  seenCompaction: false,
  maxPromptTokens: null,
  preFirstCompactionTokens: null,
  maxContextUsagePercent: null,
  preFirstCompactionUsagePercent: null,
  contextWindow: null,
  bashCommands: [],
  over80: false,
  over90: false,
  over100: false,
});

const recordTokens = (session: SessionRecord, tokens: number): void => {
  session.maxPromptTokens = Math.max(session.maxPromptTokens ?? 0, tokens);
  if (!session.seenCompaction) session.preFirstCompactionTokens = tokens;
};

const applyMessage = (
  session: SessionRecord,
  message: ContextMessage,
  windows: Map<string, number>,
): void => {
  if (message.role === "assistant") {
    for (const command of bashCommandsOf(message.content)) session.bashCommands.push(command);
  }
  if (message.role === "user") session.userMessages += 1;
  if (message.role !== "assistant") return;
  session.assistantMessages += 1;
  session.providerModel = `${message.provider ?? "[unknown]"}/${message.model ?? "[unknown]"}`;
  const contextWindow = windows.get(session.providerModel);
  if (contextWindow !== undefined) session.contextWindow = contextWindow;
  const tokens = contextTokens(message.usage);
  if (tokens !== null) recordTokens(session, tokens);
};

const applyEntry = (
  session: SessionRecord,
  entry: ContextEntry,
  windows: Map<string, number>,
): void => {
  if (entry.type === "session" && entry.cwd !== undefined) session.cwd = entry.cwd;
  const entryMs = entry.timestamp === undefined ? null : parseMillis(entry.timestamp);
  if (entryMs !== null) {
    if (session.startMs === 0 || entryMs < session.startMs) session.startMs = entryMs;
    if (session.endMs === 0 || entryMs > session.endMs) session.endMs = entryMs;
  }
  if (entry.type === "compaction") {
    session.compactions += 1;
    if (entry.tokensBefore !== undefined) recordTokens(session, entry.tokensBefore);
    session.seenCompaction = true;
    return;
  }
  if (entry.type !== "message" || entry.message === undefined) return;
  applyMessage(session, entry.message, windows);
};

const finalizeSession = (session: SessionRecord): void => {
  if (session.maxPromptTokens !== null && session.contextWindow !== null) {
    const percent = (session.maxPromptTokens / session.contextWindow) * 100;
    session.maxContextUsagePercent = percent;
    session.over80 = percent >= 80;
    session.over90 = percent >= 90;
    session.over100 = percent >= 100;
  }
  if (session.preFirstCompactionTokens !== null && session.contextWindow !== null) {
    session.preFirstCompactionUsagePercent =
      (session.preFirstCompactionTokens / session.contextWindow) * 100;
  }
};

const scanFile = (options: {
  readonly host: HostShape;
  readonly meta: ScanMeta;
  readonly sessionFile: string;
  readonly windows: Map<string, number>;
}) =>
  Effect.gen(function* () {
    const { host, meta, sessionFile, windows } = options;
    const session = emptySession(sessionFile, sessionFileMillis(host, sessionFile));
    yield* host.lines(sessionFile).pipe(
      Stream.filter((line) => line.trim() !== ""),
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          const parsed = yield* Effect.result(decodeContextEntry(line));
          if (Result.isSuccess(parsed)) {
            applyEntry(session, parsed.success, windows);
            return;
          }
          meta.malformedLines += 1;
        }),
      ),
    );
    finalizeSession(session);
    return session;
  });

const scanSessions = (options: {
  readonly cwdFilter: string | undefined;
  readonly host: HostShape;
  readonly sessionsDir: string;
  readonly sinceMs: number | null;
  readonly windows: ContextWindows;
}) =>
  Effect.gen(function* () {
    const { cwdFilter, host, sessionsDir, sinceMs } = options;
    const windows = options.windows.windows;
    const sessions: Array<SessionRecord> = [];
    const meta: ScanMeta = {
      sessionsDir,
      sessionFilesScanned: 0,
      sessionFilesIncluded: 0,
      sessionFilesSkippedOlderThanSince: 0,
      malformedLines: 0,
    };
    const files = yield* jsonlFilesRecursive({ directory: sessionsDir, host });
    yield* Effect.forEach(files, (sessionFile) =>
      Effect.gen(function* () {
        meta.sessionFilesScanned += 1;
        const fileMillis = sessionFileMillis(host, sessionFile);
        if (sinceMs !== null && fileMillis !== null && fileMillis < sinceMs) {
          meta.sessionFilesSkippedOlderThanSince += 1;
          return;
        }
        meta.sessionFilesIncluded += 1;
        const session = yield* scanFile({ host, meta, sessionFile, windows });
        if (cwdFilter === undefined || host.resolve(session.cwd ?? "") === cwdFilter) {
          sessions.push(session);
        }
      }),
    );
    return { meta, sessions };
  });

export type { ScanMeta, SessionRecord };
export { scanSessions };
