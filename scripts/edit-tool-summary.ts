import { describeSince } from "./auto-since.ts";
import {
  clusterStatsOf,
  hugeReplacementsOf,
  inflationBucketsOf,
  lengthBucketsOf,
  messageKey,
  modeStatsOf,
  outcomeOf,
  pathologicalOf,
  worstExamplesOf,
} from "./edit-tool-buckets.ts";
import type {
  ClusterStats,
  InflationBucket,
  LengthBucket,
  ModeStats,
  Threshold,
  WorstExample,
} from "./edit-tool-buckets.ts";
import type { EditRecord, EditScanMeta } from "./edit-tool-scan.ts";
import { quantile } from "./stats-format.ts";

interface EditGroupStats {
  readonly key: string;
  readonly calls: number;
  readonly resolved: number;
  readonly success: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly multi: number;
  readonly multiRate: number | null;
  readonly successRate: number | null;
  readonly medianInflation: number | null;
  readonly p95Inflation: number | null;
}

interface EditSummary {
  readonly filters: {
    readonly model: string | null;
    readonly extension: string | null;
    readonly failedOnly: boolean;
  };
  readonly scan: {
    readonly sessionsDir: string;
    readonly sessionFilesScanned: number;
    readonly sessionFilesIncluded: number;
    readonly sessionFilesSkippedOlderThanSince: number;
    readonly sessionFilesWithEditCalls: number;
    readonly since: { readonly ms: number; readonly iso: string; readonly source: string } | null;
    readonly malformedLines: number;
    readonly unmatchedToolResults: number;
  };
  readonly counts: {
    readonly assistantMessagesWithEditCalls: number;
    readonly totalEditCalls: number;
    readonly resolvedEditCalls: number;
    readonly success: number;
    readonly failed: number;
    readonly unresolved: number;
    readonly single: number;
    readonly multi: number;
    readonly noCoreChange: number;
  };
  readonly modeStats: ReadonlyArray<ModeStats>;
  readonly multiEditLengthBuckets: ReadonlyArray<LengthBucket>;
  readonly argStyles: ReadonlyArray<{ readonly style: string; readonly count: number }>;
  readonly providerStats: ReadonlyArray<EditGroupStats>;
  readonly extensionStats: ReadonlyArray<EditGroupStats>;
  readonly inflation: {
    readonly median: number | null;
    readonly p90: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
    readonly pathologicalThresholds: ReadonlyArray<Threshold>;
    readonly hugeReplacements: ReadonlyArray<Threshold>;
    readonly failureByBucket: ReadonlyArray<InflationBucket>;
  };
  readonly sameFileClusters: ClusterStats;
  readonly failureKinds: ReadonlyArray<{ readonly kind: string; readonly count: number }>;
  readonly worstExamples: ReadonlyArray<WorstExample>;
}

const countsBy = (
  records: ReadonlyArray<EditRecord>,
  keyOf: (record: EditRecord) => string,
): ReadonlyArray<readonly [string, number]> => {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = keyOf(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()];
};

const inflationsOf = (records: ReadonlyArray<EditRecord>): ReadonlyArray<number> =>
  records.flatMap((record) => (record.inflationRatio === null ? [] : [record.inflationRatio]));

const groupStatsOf = (key: string, group: ReadonlyArray<EditRecord>): EditGroupStats => {
  const { failed, resolved, success } = outcomeOf(group);
  const multi = group.filter((record) => record.mode === "multi").length;
  const inflations = inflationsOf(group);
  return {
    key,
    calls: group.length,
    resolved,
    success,
    failed,
    unresolved: group.length - resolved,
    multi,
    multiRate: group.length === 0 ? null : multi / group.length,
    successRate: resolved === 0 ? null : success / resolved,
    medianInflation: quantile(inflations, 0.5),
    p95Inflation: quantile(inflations, 0.95),
  };
};

const summarizeGroups = (
  records: ReadonlyArray<EditRecord>,
  keyOf: (record: EditRecord) => string,
): ReadonlyArray<EditGroupStats> =>
  [...Map.groupBy(records, keyOf).entries()]
    .map(([key, group]) => groupStatsOf(key, group))
    .sort((left, right) => right.calls - left.calls || left.key.localeCompare(right.key));

const argStylesOf = (records: ReadonlyArray<EditRecord>) =>
  countsBy(records, (record) => record.argStyle)
    .map(([style, count]) => ({ style, count }))
    .sort((left, right) => right.count - left.count || left.style.localeCompare(right.style));

const failureKindsOf = (records: ReadonlyArray<EditRecord>) =>
  countsBy(
    records.filter((record) => record.success === false),
    (record) => record.errorKind ?? "other",
  )
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));

const countsOf = (records: ReadonlyArray<EditRecord>): EditSummary["counts"] => {
  const { failed, resolved, success } = outcomeOf(records);
  return {
    assistantMessagesWithEditCalls: new Set(records.map(messageKey)).size,
    totalEditCalls: records.length,
    resolvedEditCalls: resolved,
    success,
    failed,
    unresolved: records.length - resolved,
    single: records.filter((record) => record.mode === "single").length,
    multi: records.filter((record) => record.mode === "multi").length,
    noCoreChange: records.filter((record) => record.inflationRatio === null).length,
  };
};

const inflationOf = (records: ReadonlyArray<EditRecord>): EditSummary["inflation"] => {
  const inflations = inflationsOf(records);
  return {
    median: quantile(inflations, 0.5),
    p90: quantile(inflations, 0.9),
    p95: quantile(inflations, 0.95),
    p99: quantile(inflations, 0.99),
    pathologicalThresholds: pathologicalOf(records),
    hugeReplacements: hugeReplacementsOf(records),
    failureByBucket: inflationBucketsOf(records),
  };
};

const buildEditSummary = (options: {
  readonly extFilter: string | undefined;
  readonly failedOnly: boolean;
  readonly meta: EditScanMeta;
  readonly modelFilter: string | undefined;
  readonly records: ReadonlyArray<EditRecord>;
  readonly top: number;
}): EditSummary => {
  const { meta, records } = options;
  return {
    filters: {
      model: options.modelFilter ?? null,
      extension: options.extFilter ?? null,
      failedOnly: options.failedOnly,
    },
    scan: {
      sessionsDir: meta.sessionsDir,
      sessionFilesScanned: meta.sessionFilesScanned,
      sessionFilesIncluded: meta.sessionFilesIncluded,
      sessionFilesSkippedOlderThanSince: meta.sessionFilesSkippedOlderThanSince,
      sessionFilesWithEditCalls: meta.sessionFilesWithEditCalls,
      since: describeSince(meta.since),
      malformedLines: meta.malformedLines,
      unmatchedToolResults: meta.unmatchedToolResults,
    },
    counts: countsOf(records),
    modeStats: modeStatsOf(records),
    multiEditLengthBuckets: lengthBucketsOf(records),
    argStyles: argStylesOf(records),
    providerStats: summarizeGroups(records, (record) => record.providerModel),
    extensionStats: summarizeGroups(records, (record) => record.extension),
    inflation: inflationOf(records),
    sameFileClusters: clusterStatsOf(records),
    failureKinds: failureKindsOf(records),
    worstExamples: worstExamplesOf({ records, top: options.top }),
  };
};

export type { EditGroupStats, EditSummary };
export { buildEditSummary };
