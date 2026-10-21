import { Effect } from "effect";

import type hostTypes from "./host.types.ts";
import sessionContextEntry from "./session-context-entry.ts";
import type sessionContextEntryTypes from "./session-context-entry.types.ts";
import type sessionContextScanTypes from "./session-context-scan.types.ts";
import type sessionContextWindowsTypes from "./session-context-windows.types.ts";
import sessionsModule from "./sessions.ts";

const { bashCommandsOf, contextTokens, decodeContextEntry, providerModelOf } = sessionContextEntry;
const {
  emptySessionFileCounts,
  forEachDecodedLine,
  forEachSessionFile,
  messageOf,
  timestampMillis,
} = sessionsModule;

const emptySession = (
  sessionFile: string,
  fileMillis: number | null,
): sessionContextScanTypes.SessionRecord => ({
  assistantMessages: 0,
  bashCommands: [],
  compactions: 0,
  contextWindow: null,
  cwd: null,
  endMs: fileMillis ?? 0,
  maxContextUsagePercent: null,
  maxPromptTokens: null,
  over100: false,
  over80: false,
  over90: false,
  preFirstCompactionTokens: null,
  preFirstCompactionUsagePercent: null,
  providerModel: "[unknown]/[unknown]",
  seenCompaction: false,
  sessionFile,
  startMs: fileMillis ?? 0,
  userMessages: 0,
});

const recordTokens = (session: sessionContextScanTypes.SessionRecord, tokens: number): void => {
  session.maxPromptTokens = Math.max(session.maxPromptTokens ?? 0, tokens);
  if (!session.seenCompaction) session.preFirstCompactionTokens = tokens;
};

const applyAssistantMessage = (
  session: sessionContextScanTypes.SessionRecord,
  message: sessionContextEntryTypes.ContextMessage,
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
  session: sessionContextScanTypes.SessionRecord,
  message: sessionContextEntryTypes.ContextMessage,
  windows: Map<string, number>,
): void => {
  if (message.role === "user") session.userMessages += 1;
  if (message.role === "assistant") applyAssistantMessage(session, message, windows);
};

const recordCwd = (
  session: sessionContextScanTypes.SessionRecord,
  entry: sessionContextEntryTypes.ContextEntry,
): void => {
  if (entry.type === "session" && entry.cwd !== undefined) session.cwd = entry.cwd;
};

const earlierMillis = (current: number, candidate: number): number =>
  current === 0 || candidate < current ? candidate : current;

const laterMillis = (current: number, candidate: number): number =>
  current === 0 || candidate > current ? candidate : current;

const extendTimeRange = (
  session: sessionContextScanTypes.SessionRecord,
  entryMs: number | null,
): void => {
  if (entryMs === null) return;
  session.startMs = earlierMillis(session.startMs, entryMs);
  session.endMs = laterMillis(session.endMs, entryMs);
};

const applyCompaction = (
  session: sessionContextScanTypes.SessionRecord,
  entry: sessionContextEntryTypes.ContextEntry,
): void => {
  session.compactions += 1;
  if (entry.tokensBefore !== undefined) recordTokens(session, entry.tokensBefore);
  session.seenCompaction = true;
};

const applyEntry = (
  session: sessionContextScanTypes.SessionRecord,
  entry: sessionContextEntryTypes.ContextEntry,
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

const finalizeSession = (session: sessionContextScanTypes.SessionRecord): void => {
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
  readonly host: hostTypes.HostShape;
  readonly meta: sessionContextScanTypes.ScanMeta;
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
  readonly host: hostTypes.HostShape;
  readonly session: sessionContextScanTypes.SessionRecord;
}): boolean =>
  options.cwdFilter === undefined ||
  options.host.resolve(options.session.cwd ?? "") === options.cwdFilter;

const scanSessions = (options: {
  readonly cwdFilter: string | undefined;
  readonly host: hostTypes.HostShape;
  readonly sessionsDir: string;
  readonly sinceMs: number | null;
  readonly windows: sessionContextWindowsTypes.ContextWindows;
}) =>
  Effect.gen(function* () {
    const { cwdFilter, host } = options;
    const windows = options.windows.windows;
    const sessions: Array<sessionContextScanTypes.SessionRecord> = [];
    const meta: sessionContextScanTypes.ScanMeta = {
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

const sessionContextScan = {
  scanSessions,
};

export default sessionContextScan;
