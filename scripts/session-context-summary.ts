import type { ScanMeta, SessionRecord } from "./session-context-scan.ts";

interface GroupSummary {
  readonly key: string;
  readonly sessions: number;
  readonly contextWindows: ReadonlyArray<number>;
  readonly assistantMessages: number;
  readonly avgTurns: number;
  readonly avgDurationMinutes: number;
  readonly avgMaxPromptTokens: number | null;
  readonly medianMaxPromptTokens: number | null;
  readonly avgMaxContextUsagePercent: number | null;
  readonly medianMaxContextUsagePercent: number | null;
  readonly medianPreFirstCompactionUsagePercent: number | null;
  readonly contextKnownSessions: number;
  readonly sessionsWithCompaction: number;
  readonly totalCompactions: number;
  readonly compactionRate: number;
  readonly over80: number;
  readonly over90: number;
  readonly over100: number;
}

interface ModelSummary extends GroupSummary {
  readonly byDay: ReadonlyArray<GroupSummary>;
}

interface SummaryFilters {
  readonly bashContains: ReadonlyArray<string>;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly modelPrefixes: ReadonlyArray<string>;
}

interface Summary {
  readonly filters: SummaryFilters;
  readonly scan: ScanMeta & {
    readonly contextWindowSources: ReadonlyArray<string>;
    readonly timezone: string;
  };
  readonly totals: GroupSummary;
  readonly byDay: ReadonlyArray<GroupSummary>;
  readonly byModel: ReadonlyArray<GroupSummary>;
  readonly byModelDay: ReadonlyArray<ModelSummary>;
}

const median = (values: ReadonlyArray<number | null>): number | null => {
  const finite = values
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  const lower = finite[middle - 1] ?? 0;
  const upper = finite[middle] ?? 0;
  return finite.length % 2 === 0 ? (lower + upper) / 2 : upper;
};

const average = (values: ReadonlyArray<number>): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const summarizeSessionGroup = (key: string, group: ReadonlyArray<SessionRecord>): GroupSummary => {
  const usage = group.flatMap((session) =>
    session.maxContextUsagePercent === null ? [] : [session.maxContextUsagePercent],
  );
  const tokens = group.flatMap((session) =>
    session.maxPromptTokens === null ? [] : [session.maxPromptTokens],
  );
  const compacted = group.filter((session) => session.compactions > 0).length;
  return {
    key,
    sessions: group.length,
    contextWindows: [
      ...new Set(
        group.flatMap((session) => (session.contextWindow === null ? [] : [session.contextWindow])),
      ),
    ].sort((left, right) => left - right),
    assistantMessages: group.reduce((sum, session) => sum + session.assistantMessages, 0),
    avgTurns: group.reduce((sum, session) => sum + session.userMessages, 0) / group.length,
    avgDurationMinutes:
      group.reduce(
        (sum, session) => sum + Math.max(0, session.endMs - session.startMs) / 60_000,
        0,
      ) / group.length,
    avgMaxPromptTokens: average(tokens),
    medianMaxPromptTokens: median(tokens),
    avgMaxContextUsagePercent: average(usage),
    medianMaxContextUsagePercent: median(usage),
    medianPreFirstCompactionUsagePercent: median(
      group.map((session) => session.preFirstCompactionUsagePercent),
    ),
    contextKnownSessions: usage.length,
    sessionsWithCompaction: compacted,
    totalCompactions: group.reduce((sum, session) => sum + session.compactions, 0),
    compactionRate: (compacted / group.length) * 100,
    over80: group.filter((session) => session.over80).length,
    over90: group.filter((session) => session.over90).length,
    over100: group.filter((session) => session.over100).length,
  };
};

const summarizeGroups = (
  sessions: ReadonlyArray<SessionRecord>,
  keyOf: (session: SessionRecord) => string,
): ReadonlyArray<GroupSummary> => {
  const groups = new Map<string, Array<SessionRecord>>();
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

const byModelOrder = (sessions: ReadonlyArray<SessionRecord>): ReadonlyArray<GroupSummary> =>
  [...summarizeGroups(sessions, (session) => session.providerModel)].sort(
    (left, right) => right.sessions - left.sessions || left.key.localeCompare(right.key),
  );

const withByDay = (model: GroupSummary, byDay: ReadonlyArray<GroupSummary>): ModelSummary => ({
  ...model,
  byDay,
});

const matchesFilters = (
  session: SessionRecord,
  options: {
    readonly bashContains: ReadonlyArray<string>;
    readonly modelFilter: string | undefined;
    readonly modelPrefixes: ReadonlyArray<string>;
  },
): boolean => {
  const providerModel = session.providerModel.toLowerCase();
  if (
    options.modelFilter !== undefined &&
    options.modelFilter !== "" &&
    !providerModel.includes(options.modelFilter.toLowerCase())
  ) {
    return false;
  }
  const prefixes = options.modelPrefixes.map((prefix) => prefix.toLowerCase());
  if (prefixes.length > 0 && !prefixes.some((prefix) => providerModel.startsWith(prefix))) {
    return false;
  }
  if (options.bashContains.length === 0) return true;
  const commands = session.bashCommands.map((command) => command.toLowerCase());
  return options.bashContains.some((text) =>
    commands.some((command) => command.includes(text.toLowerCase())),
  );
};

const buildSummary = (options: {
  readonly bashContains: ReadonlyArray<string>;
  readonly cwd: string | null;
  readonly day: (ms: number) => string;
  readonly modelFilter: string | undefined;
  readonly modelPrefixes: ReadonlyArray<string>;
  readonly scan: Summary["scan"];
  readonly sessions: ReadonlyArray<SessionRecord>;
}): Summary => {
  const filtered = options.sessions.filter((session) => matchesFilters(session, options));
  return {
    filters: {
      model: options.modelFilter ?? null,
      modelPrefixes: options.modelPrefixes,
      bashContains: options.bashContains,
      cwd: options.cwd,
    },
    scan: options.scan,
    totals: summarizeSessionGroup("total", filtered),
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
  };
};

export type { GroupSummary, ModelSummary, Summary };
export { buildSummary };
