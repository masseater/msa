import { Effect } from "effect";

import type { HostShape } from "./host.ts";
import {
  bashCommandsOf,
  contextTokens,
  decodeContextEntry,
  providerModelOf,
} from "./session-context-entry.ts";
import type { ContextEntry, ContextMessage } from "./session-context-entry.ts";
import type { ContextWindows } from "./session-context-windows.ts";
import {
  emptySessionFileCounts,
  forEachDecodedLine,
  forEachSessionFile,
  messageOf,
  timestampMillis,
} from "./sessions.ts";

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

const applyAssistantMessage = (
  session: SessionRecord,
  message: ContextMessage,
  windows: Map<string, number>,
): void => {
  session.bashCommands.push(...bashCommandsOf(message));
  session.assistantMessages += 1;
  session.providerModel = providerModelOf(message);
  const contextWindow = windows.get(session.providerModel);
  if (contextWindow !== undefined) session.contextWindow = contextWindow;
  const tokens = contextTokens(message.usage);
  if (tokens !== null) recordTokens(session, tokens);
};

const applyMessage = (
  session: SessionRecord,
  message: ContextMessage,
  windows: Map<string, number>,
): void => {
  if (message.role === "user") session.userMessages += 1;
  if (message.role === "assistant") applyAssistantMessage(session, message, windows);
};

const recordCwd = (session: SessionRecord, entry: ContextEntry): void => {
  if (entry.type === "session" && entry.cwd !== undefined) session.cwd = entry.cwd;
};

const earlierMillis = (current: number, candidate: number): number =>
  current === 0 || candidate < current ? candidate : current;

const laterMillis = (current: number, candidate: number): number =>
  current === 0 || candidate > current ? candidate : current;

const extendTimeRange = (session: SessionRecord, entryMs: number | null): void => {
  if (entryMs === null) return;
  session.startMs = earlierMillis(session.startMs, entryMs);
  session.endMs = laterMillis(session.endMs, entryMs);
};

const applyCompaction = (session: SessionRecord, entry: ContextEntry): void => {
  session.compactions += 1;
  if (entry.tokensBefore !== undefined) recordTokens(session, entry.tokensBefore);
  session.seenCompaction = true;
};

const applyEntry = (
  session: SessionRecord,
  entry: ContextEntry,
  windows: Map<string, number>,
): void => {
  recordCwd(session, entry);
  extendTimeRange(session, timestampMillis(entry.timestamp));
  const message = messageOf(entry);
  if (entry.type === "compaction") applyCompaction(session, entry);
  else if (message !== undefined) applyMessage(session, message, windows);
};

const usagePercent = (tokens: number | null, contextWindow: number | null): number | null =>
  tokens === null || contextWindow === null ? null : (tokens / contextWindow) * 100;

const finalizeSession = (session: SessionRecord): void => {
  const percent = usagePercent(session.maxPromptTokens, session.contextWindow);
  if (percent !== null) {
    session.maxContextUsagePercent = percent;
    session.over80 = percent >= 80;
    session.over90 = percent >= 90;
    session.over100 = percent >= 100;
  }
  session.preFirstCompactionUsagePercent = usagePercent(
    session.preFirstCompactionTokens,
    session.contextWindow,
  );
};

const scanFile = (options: {
  readonly host: HostShape;
  readonly meta: ScanMeta;
  readonly sessionFile: string;
  readonly sessionMillis: number | null;
  readonly windows: Map<string, number>;
}) =>
  Effect.gen(function* () {
    const { meta, windows } = options;
    const session = emptySession(options.sessionFile, options.sessionMillis);
    yield* forEachDecodedLine({
      decode: decodeContextEntry,
      file: options.sessionFile,
      host: options.host,
      onEntry: (entry) => applyEntry(session, entry, windows),
      onMalformed: () => {
        meta.malformedLines += 1;
      },
    });
    finalizeSession(session);
    return session;
  });

const matchesCwd = (options: {
  readonly cwdFilter: string | undefined;
  readonly host: HostShape;
  readonly session: SessionRecord;
}): boolean =>
  options.cwdFilter === undefined ||
  options.host.resolve(options.session.cwd ?? "") === options.cwdFilter;

const scanSessions = (options: {
  readonly cwdFilter: string | undefined;
  readonly host: HostShape;
  readonly sessionsDir: string;
  readonly sinceMs: number | null;
  readonly windows: ContextWindows;
}) =>
  Effect.gen(function* () {
    const { cwdFilter, host } = options;
    const windows = options.windows.windows;
    const sessions: Array<SessionRecord> = [];
    const meta: ScanMeta = {
      sessionsDir: options.sessionsDir,
      ...emptySessionFileCounts(),
      malformedLines: 0,
    };
    yield* forEachSessionFile({
      counts: meta,
      host,
      scan: ({ sessionFile, sessionMillis }) =>
        Effect.map(scanFile({ host, meta, sessionFile, sessionMillis, windows }), (session) => {
          if (matchesCwd({ cwdFilter, host, session })) sessions.push(session);
        }),
      sessionsDir: options.sessionsDir,
      sinceMs: options.sinceMs,
    });
    return { meta, sessions };
  });

export type { ScanMeta, SessionRecord };
export { scanSessions };
