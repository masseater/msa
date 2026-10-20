import autoSince from "./auto-since.ts";
import type readToolScanTypes from "./read-tool-scan.types.ts";
import type readToolSummaryTypes from "./read-tool-summary.types.ts";
import statsFormat from "./stats-format.ts";

const { median, ratio } = statsFormat;
const { describeSince } = autoSince;

const groupBy = (
  records: ReadonlyArray<readToolScanTypes.ReadRecord>,
  keyOf: (record: readToolScanTypes.ReadRecord) => string,
): ReadonlyArray<readonly [string, ReadonlyArray<readToolScanTypes.ReadRecord>]> => [
  ...Map.groupBy(records, keyOf).entries(),
];

const messageKey = (record: readToolScanTypes.ReadRecord): string =>
  `${record.sessionFile}::${record.assistantEntryId}`;

const fullCount = (records: ReadonlyArray<readToolScanTypes.ReadRecord>): number =>
  records.filter((record) => record.mode === "full").length;

const groupStats = (
  key: string,
  group: ReadonlyArray<readToolScanTypes.ReadRecord>,
): readToolSummaryTypes.GroupStats => {
  const full = fullCount(group);
  return {
    assistantMessages: new Set(group.map(messageKey)).size,
    full,
    fullRate: ratio(full, group.length),
    key,
    partial: group.length - full,
    partialRate: ratio(group.length - full, group.length),
    reads: group.length,
  };
};

const summarizeGroups = (
  records: ReadonlyArray<readToolScanTypes.ReadRecord>,
  keyOf: (record: readToolScanTypes.ReadRecord) => string,
): ReadonlyArray<readToolSummaryTypes.GroupStats> =>
  groupBy(records, keyOf)
    .map(([key, group]) => groupStats(key, group))
    .sort((left, right) => right.reads - left.reads || left.key.localeCompare(right.key));

const sessionPartialRate = (group: ReadonlyArray<readToolScanTypes.ReadRecord>): number | null =>
  ratio(group.filter((record) => record.mode !== "full").length, group.length);

const normalizedStats = (
  key: string,
  group: ReadonlyArray<readToolScanTypes.ReadRecord>,
): readToolSummaryTypes.NormalizedStats => {
  const sessions = groupBy(group, (record) => record.sessionFile).map(([, records]) => records);
  const full = fullCount(group);
  const sessionCount = sessions.length;
  return {
    full,
    fullPerSession: ratio(full, sessionCount),
    key,
    medianSessionPartialRate: median(sessions.map(sessionPartialRate)),
    partial: group.length - full,
    partialPerSession: ratio(group.length - full, sessionCount),
    reads: group.length,
    readsPerSession: ratio(group.length, sessionCount),
    sessions: sessionCount,
  };
};

const summarizeNormalized = (
  records: ReadonlyArray<readToolScanTypes.ReadRecord>,
  keyOf: (record: readToolScanTypes.ReadRecord) => string,
): ReadonlyArray<readToolSummaryTypes.NormalizedStats> =>
  groupBy(records, keyOf)
    .map(([key, group]) => normalizedStats(key, group))
    .sort((left, right) => left.key.localeCompare(right.key));

const byKey = (
  groups: ReadonlyArray<readToolSummaryTypes.GroupStats>,
): ReadonlyArray<readToolSummaryTypes.GroupStats> =>
  [...groups].sort((left, right) => left.key.localeCompare(right.key));

const providerStatsOf = (options: {
  readonly bucketOf: (record: readToolScanTypes.ReadRecord) => string;
  readonly hourOf: (record: readToolScanTypes.ReadRecord) => string;
  readonly provider: readToolSummaryTypes.GroupStats;
  readonly records: ReadonlyArray<readToolScanTypes.ReadRecord>;
}): readToolSummaryTypes.ProviderStats => {
  const { bucketOf, hourOf, provider } = options;
  const records = options.records.filter((record) => record.providerModel === provider.key);
  return {
    providerModel: provider.key,
    ...provider,
    normalizedTimeOfDayStats: summarizeNormalized(records, hourOf),
    normalizedTimeStats: summarizeNormalized(records, bucketOf),
    timeOfDayStats: byKey(summarizeGroups(records, hourOf)),
    timeStats: byKey(summarizeGroups(records, bucketOf)),
  };
};

const countsOf = (
  records: ReadonlyArray<readToolScanTypes.ReadRecord>,
): readToolSummaryTypes.ReadSummary["counts"] => {
  const full = fullCount(records);
  return {
    assistantMessagesWithReadCalls: new Set(records.map(messageKey)).size,
    full,
    fullRate: ratio(full, records.length),
    partial: records.length - full,
    partialRate: ratio(records.length - full, records.length),
    totalReadCalls: records.length,
  };
};

const buildReadSummary = (options: {
  readonly bucket: string;
  readonly bucketOf: (record: readToolScanTypes.ReadRecord) => string;
  readonly hourOf: (record: readToolScanTypes.ReadRecord) => string;
  readonly meta: readToolScanTypes.ReadScanMeta;
  readonly modelFilter: string | undefined;
  readonly records: ReadonlyArray<readToolScanTypes.ReadRecord>;
  readonly top: number;
}): readToolSummaryTypes.ReadSummary => {
  const { bucketOf, hourOf, meta, records } = options;
  const providerStats = summarizeGroups(records, (record) => record.providerModel);
  return {
    counts: countsOf(records),
    examples: records.slice(0, options.top),
    filters: { bucket: options.bucket, model: options.modelFilter ?? null },
    normalizedTimeOfDayStats: summarizeNormalized(records, hourOf),
    normalizedTimeStats: summarizeNormalized(records, bucketOf),
    providerStats,
    scan: {
      malformedLines: meta.malformedLines,
      sessionFilesIncluded: meta.sessionFilesIncluded,
      sessionFilesScanned: meta.sessionFilesScanned,
      sessionFilesSkippedOlderThanSince: meta.sessionFilesSkippedOlderThanSince,
      sessionFilesWithReadCalls: meta.sessionFilesWithReadCalls,
      sessionsDir: meta.sessionsDir,
      since: describeSince(meta.since),
    },
    timeOfDayStats: byKey(summarizeGroups(records, hourOf)),
    timeStats: byKey(summarizeGroups(records, bucketOf)),
    timeStatsByProvider: providerStats.map((provider) =>
      providerStatsOf({ bucketOf, hourOf, provider, records }),
    ),
  };
};

const readToolSummary = {
  buildReadSummary,
};

export default readToolSummary;
