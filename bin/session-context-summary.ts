import scanOptionsModule from "./scan-options.ts";
import type sessionContextScanTypes from "./session-context-scan.types.ts";
import type sessionContextSummaryTypes from "./session-context-summary.types.ts";

const { matchesModelFilter } = scanOptionsModule;

const average = (values: ReadonlyArray<number>): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const middleValues = (sorted: ReadonlyArray<number>): ReadonlyArray<number> => {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? sorted.slice(middle - 1, middle + 1)
    : sorted.slice(middle, middle + 1);
};

const median = (values: ReadonlyArray<number | null>): number | null =>
  average(
    middleValues(
      values
        .filter((value): value is number => value !== null && Number.isFinite(value))
        .sort((left, right) => left - right),
    ),
  );

const summarizeSessionGroup = (
  key: string,
  group: ReadonlyArray<sessionContextScanTypes.SessionRecord>,
): sessionContextSummaryTypes.GroupSummary => {
  const usage = group.flatMap((session) =>
    session.maxContextUsagePercent === null ? [] : [session.maxContextUsagePercent],
  );
  const tokens = group.flatMap((session) =>
    session.maxPromptTokens === null ? [] : [session.maxPromptTokens],
  );
  const compacted = group.filter((session) => session.compactions > 0).length;
  return {
    assistantMessages: group.reduce((sum, session) => sum + session.assistantMessages, 0),
    avgDurationMinutes:
      group.reduce(
        (sum, session) => sum + Math.max(0, session.endMs - session.startMs) / 60_000,
        0,
      ) / group.length,
    avgMaxContextUsagePercent: average(usage),
    avgMaxPromptTokens: average(tokens),
    avgTurns: group.reduce((sum, session) => sum + session.userMessages, 0) / group.length,
    compactionRate: (compacted / group.length) * 100,
    contextKnownSessions: usage.length,
    contextWindows: [
      ...new Set(
        group.flatMap((session) => (session.contextWindow === null ? [] : [session.contextWindow])),
      ),
    ].sort((left, right) => left - right),
    key,
    medianMaxContextUsagePercent: median(usage),
    medianMaxPromptTokens: median(tokens),
    medianPreFirstCompactionUsagePercent: median(
      group.map((session) => session.preFirstCompactionUsagePercent),
    ),
    over100: group.filter((session) => session.over100).length,
    over80: group.filter((session) => session.over80).length,
    over90: group.filter((session) => session.over90).length,
    sessions: group.length,
    sessionsWithCompaction: compacted,
    totalCompactions: group.reduce((sum, session) => sum + session.compactions, 0),
  };
};

const summarizeGroups = (
  sessions: ReadonlyArray<sessionContextScanTypes.SessionRecord>,
  keyOf: (session: sessionContextScanTypes.SessionRecord) => string,
): ReadonlyArray<sessionContextSummaryTypes.GroupSummary> => {
  const groups = new Map<string, Array<sessionContextScanTypes.SessionRecord>>();
  for (const session of sessions) {
    const key = keyOf(session);
    const group = groups.get(key) ?? [];
    groups.set(key, group);
    group.push(session);
  }
  return [...groups.entries()]
    .map(([key, group]) => summarizeSessionGroup(key, group))
    .sort((left, right) => left.key.localeCompare(right.key));
};

const byModelOrder = (
  sessions: ReadonlyArray<sessionContextScanTypes.SessionRecord>,
): ReadonlyArray<sessionContextSummaryTypes.GroupSummary> =>
  [...summarizeGroups(sessions, (session) => session.providerModel)].sort(
    (left, right) => right.sessions - left.sessions || left.key.localeCompare(right.key),
  );

const withByDay = (
  model: sessionContextSummaryTypes.GroupSummary,
  byDay: ReadonlyArray<sessionContextSummaryTypes.GroupSummary>,
): sessionContextSummaryTypes.ModelSummary => ({
  ...model,
  byDay,
});

const matchesPrefixes = (providerModel: string, prefixes: ReadonlyArray<string>): boolean =>
  prefixes.length === 0 ||
  prefixes.some((prefix) => providerModel.toLowerCase().startsWith(prefix.toLowerCase()));

const matchesBash = (
  bashCommands: ReadonlyArray<string>,
  bashContains: ReadonlyArray<string>,
): boolean => {
  if (bashContains.length === 0) return true;
  const commands = bashCommands.map((command) => command.toLowerCase());
  return bashContains.some((text) =>
    commands.some((command) => command.includes(text.toLowerCase())),
  );
};

const matchesFilters = (
  session: sessionContextScanTypes.SessionRecord,
  options: {
    readonly bashContains: ReadonlyArray<string>;
    readonly modelFilter: string | undefined;
    readonly modelPrefixes: ReadonlyArray<string>;
  },
): boolean =>
  matchesModelFilter({ modelFilter: options.modelFilter, providerModel: session.providerModel }) &&
  matchesPrefixes(session.providerModel, options.modelPrefixes) &&
  matchesBash(session.bashCommands, options.bashContains);

const buildSummary = (options: {
  readonly bashContains: ReadonlyArray<string>;
  readonly cwd: string | null;
  readonly day: (ms: number) => string;
  readonly modelFilter: string | undefined;
  readonly modelPrefixes: ReadonlyArray<string>;
  readonly scan: sessionContextSummaryTypes.Summary["scan"];
  readonly sessions: ReadonlyArray<sessionContextScanTypes.SessionRecord>;
}): sessionContextSummaryTypes.Summary => {
  const filtered = options.sessions.filter((session) => matchesFilters(session, options));
  return {
    byDay: summarizeGroups(filtered, (session) => options.day(session.startMs)),
    byModel: byModelOrder(filtered),
    byModelDay: byModelOrder(filtered).map((model) =>
      withByDay(
        model,
        summarizeGroups(
          filtered.filter((session) => session.providerModel === model.key),
          (session) => options.day(session.startMs),
        ),
      ),
    ),
    filters: {
      bashContains: options.bashContains,
      cwd: options.cwd,
      model: options.modelFilter ?? null,
      modelPrefixes: options.modelPrefixes,
    },
    scan: options.scan,
    totals: summarizeSessionGroup("total", filtered),
  };
};

const sessionContextSummary = {
  buildSummary,
};

export default sessionContextSummary;
