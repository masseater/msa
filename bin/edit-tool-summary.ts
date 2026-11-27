import autoSince from "./auto-since.ts";
import editToolBuckets from "./edit-tool-buckets.ts";
import type editToolScanTypes from "./edit-tool-scan.types.ts";
import type editToolSummaryTypes from "./edit-tool-summary.types.ts";
import statsFormat from "./stats-format.ts";

const {
  clusterStatsOf,
  hugeReplacementsOf,
  inflationBucketsOf,
  lengthBucketsOf,
  messageKey,
  modeStatsOf,
  outcomeOf,
  pathologicalOf,
  worstExamplesOf,
} = editToolBuckets;
const { quantile } = statsFormat;
const { describeSince } = autoSince;

const countsBy = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
  keyOf: (record: editToolScanTypes.EditRecord) => string,
): ReadonlyArray<readonly [string, number]> => {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = keyOf(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()];
};

const inflationsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): ReadonlyArray<number> =>
  records.flatMap((record) => (record.inflationRatio === null ? [] : [record.inflationRatio]));

const groupStatsOf = (
  key: string,
  group: ReadonlyArray<editToolScanTypes.EditRecord>,
): editToolSummaryTypes.EditGroupStats => {
  const { failed, resolved, success } = outcomeOf(group);
  const multi = group.filter((record) => record.mode === "multi").length;
  const inflations = inflationsOf(group);
  return {
    calls: group.length,
    failed,
    key,
    medianInflation: quantile(inflations, 0.5),
    multi,
    multiRate: group.length === 0 ? null : multi / group.length,
    p95Inflation: quantile(inflations, 0.95),
    resolved,
    success,
    successRate: resolved === 0 ? null : success / resolved,
    unresolved: group.length - resolved,
  };
};

const summarizeGroups = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
  keyOf: (record: editToolScanTypes.EditRecord) => string,
): ReadonlyArray<editToolSummaryTypes.EditGroupStats> =>
  [...Map.groupBy(records, keyOf).entries()]
    .map(([key, group]) => groupStatsOf(key, group))
    .sort((left, right) => right.calls - left.calls || left.key.localeCompare(right.key));

const argStylesOf = (records: ReadonlyArray<editToolScanTypes.EditRecord>) =>
  countsBy(records, (record) => record.argStyle)
    .map(([style, count]) => ({ count, style }))
    .sort((left, right) => right.count - left.count || left.style.localeCompare(right.style));

const failureKindsOf = (records: ReadonlyArray<editToolScanTypes.EditRecord>) =>
  countsBy(
    records.filter((record) => record.success === false),
    (record) => record.errorKind ?? "other",
  )
    .map(([kind, count]) => ({ count, kind }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));

const countsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): editToolSummaryTypes.EditSummary["counts"] => {
  const { failed, resolved, success } = outcomeOf(records);
  return {
    assistantMessagesWithEditCalls: new Set(records.map(messageKey)).size,
    failed,
    multi: records.filter((record) => record.mode === "multi").length,
    noCoreChange: records.filter((record) => record.inflationRatio === null).length,
    resolvedEditCalls: resolved,
    single: records.filter((record) => record.mode === "single").length,
    success,
    totalEditCalls: records.length,
    unresolved: records.length - resolved,
  };
};

const inflationOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): editToolSummaryTypes.EditSummary["inflation"] => {
  const inflations = inflationsOf(records);
  return {
    failureByBucket: inflationBucketsOf(records),
    hugeReplacements: hugeReplacementsOf(records),
    median: quantile(inflations, 0.5),
    p90: quantile(inflations, 0.9),
    p95: quantile(inflations, 0.95),
    p99: quantile(inflations, 0.99),
    pathologicalThresholds: pathologicalOf(records),
  };
};

const buildEditSummary = (options: {
  readonly extFilter: string | undefined;
  readonly failedOnly: boolean;
  readonly meta: editToolScanTypes.EditScanMeta;
  readonly modelFilter: string | undefined;
  readonly records: ReadonlyArray<editToolScanTypes.EditRecord>;
  readonly top: number;
}): editToolSummaryTypes.EditSummary => {
  const { meta, records } = options;
  return {
    argStyles: argStylesOf(records),
    counts: countsOf(records),
    extensionStats: summarizeGroups(records, (record) => record.extension),
    failureKinds: failureKindsOf(records),
    filters: {
      extension: options.extFilter ?? null,
      failedOnly: options.failedOnly,
      model: options.modelFilter ?? null,
    },
    inflation: inflationOf(records),
    modeStats: modeStatsOf(records),
    multiEditLengthBuckets: lengthBucketsOf(records),
    providerStats: summarizeGroups(records, (record) => record.providerModel),
    sameFileClusters: clusterStatsOf(records),
    scan: {
      malformedLines: meta.malformedLines,
      sessionFilesIncluded: meta.sessionFilesIncluded,
      sessionFilesScanned: meta.sessionFilesScanned,
      sessionFilesSkippedOlderThanSince: meta.sessionFilesSkippedOlderThanSince,
      sessionFilesWithEditCalls: meta.sessionFilesWithEditCalls,
      sessionsDir: meta.sessionsDir,
      since: describeSince(meta.since),
      unmatchedToolResults: meta.unmatchedToolResults,
    },
    worstExamples: worstExamplesOf({ records, top: options.top }),
  };
};

const editToolSummary = {
  buildEditSummary,
};

export default editToolSummary;
