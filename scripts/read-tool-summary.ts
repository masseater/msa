import type { ReadRecord, ReadScanMeta } from "./read-tool-scan.ts";
import { formatIsoMillis, median } from "./stats-format.ts";

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
): ReadonlyArray<readonly [string, ReadonlyArray<ReadRecord>]> => {
  const groups = new Map<string, Array<ReadRecord>>();
  for (const record of records) {
    const key = keyOf(record);
    const group = groups.get(key) ?? [];
    groups.set(key, group);
    group.push(record);
  }
  return [...groups.entries()];
};

const messageKey = (record: ReadRecord): string =>
  `${record.sessionFile}::${record.assistantEntryId}`;

const groupStats = (key: string, group: ReadonlyArray<ReadRecord>): GroupStats => {
  const full = group.filter((record) => record.mode === "full").length;
  return {
    key,
    reads: group.length,
    assistantMessages: new Set(group.map(messageKey)).size,
    full,
    partial: group.length - full,
    fullRate: group.length === 0 ? null : full / group.length,
    partialRate: group.length === 0 ? null : (group.length - full) / group.length,
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
  group.length === 0
    ? null
    : group.filter((record) => record.mode !== "full").length / group.length;

const normalizedStats = (key: string, group: ReadonlyArray<ReadRecord>): NormalizedStats => {
  const sessions = groupBy(group, (record) => record.sessionFile).map(([, records]) => records);
  const full = group.filter((record) => record.mode === "full").length;
  const sessionCount = sessions.length;
  return {
    key,
    sessions: sessionCount,
    reads: group.length,
    full,
    partial: group.length - full,
    readsPerSession: sessionCount === 0 ? null : group.length / sessionCount,
    fullPerSession: sessionCount === 0 ? null : full / sessionCount,
    partialPerSession: sessionCount === 0 ? null : (group.length - full) / sessionCount,
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
  const full = records.filter((record) => record.mode === "full").length;
  const providerStats = summarizeGroups(records, (record) => record.providerModel);
  return {
    filters: { model: options.modelFilter ?? null, bucket: options.bucket },
    scan: {
      sessionsDir: meta.sessionsDir,
      sessionFilesScanned: meta.sessionFilesScanned,
      sessionFilesIncluded: meta.sessionFilesIncluded,
      sessionFilesSkippedOlderThanSince: meta.sessionFilesSkippedOlderThanSince,
      sessionFilesWithReadCalls: meta.sessionFilesWithReadCalls,
      since:
        meta.since === null
          ? null
          : { ms: meta.since.ms, iso: formatIsoMillis(meta.since.ms), source: meta.since.source },
      malformedLines: meta.malformedLines,
    },
    counts: {
      assistantMessagesWithReadCalls: new Set(records.map(messageKey)).size,
      totalReadCalls: records.length,
      full,
      partial: records.length - full,
      fullRate: records.length === 0 ? null : full / records.length,
      partialRate: records.length === 0 ? null : (records.length - full) / records.length,
    },
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
