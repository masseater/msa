import { describeSince } from "./auto-since.ts";
import type { ReadRecord, ReadScanMeta } from "./read-tool-scan.ts";
import { median, ratio } from "./stats-format.ts";

interface GroupStats {
  readonly key: string;
  readonly reads: number;
  readonly assistantMessages: number;
  readonly full: number;
  readonly partial: number;
  readonly fullRate: number | null;
  readonly partialRate: number | null;
}

interface NormalizedStats {
  readonly key: string;
  readonly sessions: number;
  readonly reads: number;
  readonly full: number;
  readonly partial: number;
  readonly readsPerSession: number | null;
  readonly fullPerSession: number | null;
  readonly partialPerSession: number | null;
  readonly medianSessionPartialRate: number | null;
}

interface ProviderStats extends GroupStats {
  readonly providerModel: string;
  readonly timeStats: ReadonlyArray<GroupStats>;
  readonly normalizedTimeStats: ReadonlyArray<NormalizedStats>;
  readonly timeOfDayStats: ReadonlyArray<GroupStats>;
  readonly normalizedTimeOfDayStats: ReadonlyArray<NormalizedStats>;
}

interface ReadSummary {
  readonly filters: { readonly model: string | null; readonly bucket: string };
  readonly scan: {
    readonly sessionsDir: string;
    readonly sessionFilesScanned: number;
    readonly sessionFilesIncluded: number;
    readonly sessionFilesSkippedOlderThanSince: number;
    readonly sessionFilesWithReadCalls: number;
    readonly since: { readonly ms: number; readonly iso: string; readonly source: string } | null;
    readonly malformedLines: number;
  };
  readonly counts: {
    readonly assistantMessagesWithReadCalls: number;
    readonly totalReadCalls: number;
    readonly full: number;
    readonly partial: number;
    readonly fullRate: number | null;
    readonly partialRate: number | null;
  };
  readonly providerStats: ReadonlyArray<GroupStats>;
  readonly timeStats: ReadonlyArray<GroupStats>;
  readonly normalizedTimeStats: ReadonlyArray<NormalizedStats>;
  readonly timeOfDayStats: ReadonlyArray<GroupStats>;
  readonly normalizedTimeOfDayStats: ReadonlyArray<NormalizedStats>;
  readonly timeStatsByProvider: ReadonlyArray<ProviderStats>;
  readonly examples: ReadonlyArray<ReadRecord>;
}

const groupBy = (
  records: ReadonlyArray<ReadRecord>,
  keyOf: (record: ReadRecord) => string,
): ReadonlyArray<readonly [string, ReadonlyArray<ReadRecord>]> => [
  ...Map.groupBy(records, keyOf).entries(),
];

const messageKey = (record: ReadRecord): string =>
  `${record.sessionFile}::${record.assistantEntryId}`;

const fullCount = (records: ReadonlyArray<ReadRecord>): number =>
  records.filter((record) => record.mode === "full").length;

const groupStats = (key: string, group: ReadonlyArray<ReadRecord>): GroupStats => {
  const full = fullCount(group);
  return {
    key,
    reads: group.length,
    assistantMessages: new Set(group.map(messageKey)).size,
    full,
    partial: group.length - full,
    fullRate: ratio(full, group.length),
    partialRate: ratio(group.length - full, group.length),
  };
};

const summarizeGroups = (
  records: ReadonlyArray<ReadRecord>,
  keyOf: (record: ReadRecord) => string,
): ReadonlyArray<GroupStats> =>
  groupBy(records, keyOf)
    .map(([key, group]) => groupStats(key, group))
    .sort((left, right) => right.reads - left.reads || left.key.localeCompare(right.key));

const sessionPartialRate = (group: ReadonlyArray<ReadRecord>): number | null =>
  ratio(group.filter((record) => record.mode !== "full").length, group.length);

const normalizedStats = (key: string, group: ReadonlyArray<ReadRecord>): NormalizedStats => {
  const sessions = groupBy(group, (record) => record.sessionFile).map(([, records]) => records);
  const full = fullCount(group);
  const sessionCount = sessions.length;
  return {
    key,
    sessions: sessionCount,
    reads: group.length,
    full,
    partial: group.length - full,
    readsPerSession: ratio(group.length, sessionCount),
    fullPerSession: ratio(full, sessionCount),
    partialPerSession: ratio(group.length - full, sessionCount),
    medianSessionPartialRate: median(sessions.map(sessionPartialRate)),
  };
};

const summarizeNormalized = (
  records: ReadonlyArray<ReadRecord>,
  keyOf: (record: ReadRecord) => string,
): ReadonlyArray<NormalizedStats> =>
  groupBy(records, keyOf)
    .map(([key, group]) => normalizedStats(key, group))
    .sort((left, right) => left.key.localeCompare(right.key));

const byKey = (groups: ReadonlyArray<GroupStats>): ReadonlyArray<GroupStats> =>
  [...groups].sort((left, right) => left.key.localeCompare(right.key));

const providerStatsOf = (options: {
  readonly bucketOf: (record: ReadRecord) => string;
  readonly hourOf: (record: ReadRecord) => string;
  readonly provider: GroupStats;
  readonly records: ReadonlyArray<ReadRecord>;
}): ProviderStats => {
  const { bucketOf, hourOf, provider } = options;
  const records = options.records.filter((record) => record.providerModel === provider.key);
  return {
    providerModel: provider.key,
    ...provider,
    timeStats: byKey(summarizeGroups(records, bucketOf)),
    normalizedTimeStats: summarizeNormalized(records, bucketOf),
    timeOfDayStats: byKey(summarizeGroups(records, hourOf)),
    normalizedTimeOfDayStats: summarizeNormalized(records, hourOf),
  };
};

const countsOf = (records: ReadonlyArray<ReadRecord>): ReadSummary["counts"] => {
  const full = fullCount(records);
  return {
    assistantMessagesWithReadCalls: new Set(records.map(messageKey)).size,
    totalReadCalls: records.length,
    full,
    partial: records.length - full,
    fullRate: ratio(full, records.length),
    partialRate: ratio(records.length - full, records.length),
  };
};

const buildReadSummary = (options: {
  readonly bucket: string;
  readonly bucketOf: (record: ReadRecord) => string;
  readonly hourOf: (record: ReadRecord) => string;
  readonly meta: ReadScanMeta;
  readonly modelFilter: string | undefined;
  readonly records: ReadonlyArray<ReadRecord>;
  readonly top: number;
}): ReadSummary => {
  const { bucketOf, hourOf, meta, records } = options;
  const providerStats = summarizeGroups(records, (record) => record.providerModel);
  return {
    filters: { model: options.modelFilter ?? null, bucket: options.bucket },
    scan: {
      sessionsDir: meta.sessionsDir,
      sessionFilesScanned: meta.sessionFilesScanned,
      sessionFilesIncluded: meta.sessionFilesIncluded,
      sessionFilesSkippedOlderThanSince: meta.sessionFilesSkippedOlderThanSince,
      sessionFilesWithReadCalls: meta.sessionFilesWithReadCalls,
      since: describeSince(meta.since),
      malformedLines: meta.malformedLines,
    },
    counts: countsOf(records),
    providerStats,
    timeStats: byKey(summarizeGroups(records, bucketOf)),
    normalizedTimeStats: summarizeNormalized(records, bucketOf),
    timeOfDayStats: byKey(summarizeGroups(records, hourOf)),
    normalizedTimeOfDayStats: summarizeNormalized(records, hourOf),
    timeStatsByProvider: providerStats.map((provider) =>
      providerStatsOf({ bucketOf, hourOf, provider, records }),
    ),
    examples: records.slice(0, options.top),
  };
};

export type { GroupStats, NormalizedStats, ProviderStats, ReadSummary };
export { buildReadSummary };
