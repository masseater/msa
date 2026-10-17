import type { EditRecord } from "./edit-tool-scan.ts";

interface Outcome {
  readonly resolved: number;
  readonly success: number;
  readonly failed: number;
}

interface ModeStats extends Outcome {
  readonly mode: string;
  readonly calls: number;
  readonly unresolved: number;
  readonly successRate: number | null;
  readonly failureRate: number | null;
}

interface LengthBucket extends Outcome {
  readonly key: string;
  readonly label: string;
  readonly calls: number;
  readonly unresolved: number;
  readonly successRate: number | null;
  readonly failureRate: number | null;
}

interface InflationBucket {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly resolved: number;
  readonly failed: number;
  readonly failureRate: number | null;
}

interface ClusterStats {
  readonly clustersCount: number;
  readonly assistantMessagesWithCluster: number;
  readonly assistantMessagesWithMultiEdit: number;
  readonly callsInsideClusters: number;
  readonly averageCallsPerCluster: number | null;
  readonly ratioClusterAssistantMessagesToMultiEditAssistantMessages: number | null;
}

interface WorstExample {
  readonly providerModel: string;
  readonly extension: string;
  readonly path: string;
  readonly inflationRatio: number | null;
  readonly totalEditBytes: number;
  readonly coreBytes: number;
  readonly mode: string;
  readonly editsCount: number;
  readonly failed: boolean;
  readonly errorKind: string | null;
  readonly sessionFile: string;
}

interface Threshold {
  readonly threshold: number;
  readonly count: number;
}

const LENGTH_BUCKETS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly test: (record: EditRecord) => boolean;
}> = [
  {
    key: "1",
    label: "edits.length === 1",
    test: (record) => record.mode === "multi" && record.editsCount === 1,
  },
  {
    key: "2",
    label: "edits.length === 2",
    test: (record) => record.mode === "multi" && record.editsCount === 2,
  },
  {
    key: "3plus",
    label: "edits.length >= 3",
    test: (record) => record.mode === "multi" && record.editsCount >= 3,
  },
];

const INFLATION_BUCKETS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly test: (record: EditRecord) => boolean;
}> = [
  { key: "no_core_change", label: "no-core-change", test: (r) => r.inflationRatio === null },
  { key: "lt4", label: "<4x", test: (r) => r.inflationRatio !== null && r.inflationRatio < 4 },
  {
    key: "4to10",
    label: "4-10x",
    test: (r) => r.inflationRatio !== null && r.inflationRatio >= 4 && r.inflationRatio < 10,
  },
  {
    key: "10to25",
    label: "10-25x",
    test: (r) => r.inflationRatio !== null && r.inflationRatio >= 10 && r.inflationRatio < 25,
  },
  { key: "gte25", label: "25x+", test: (r) => r.inflationRatio !== null && r.inflationRatio >= 25 },
];

const HUGE_THRESHOLDS: ReadonlyArray<number> = [1024, 4096, 16_384, 65_536];

const PATHOLOGICAL_THRESHOLDS: ReadonlyArray<number> = [10, 25, 100];

const outcomeOf = (records: ReadonlyArray<EditRecord>): Outcome => {
  const resolved = records.filter((record) => record.success !== null);
  return {
    resolved: resolved.length,
    success: resolved.filter((record) => record.success === true).length,
    failed: resolved.filter((record) => record.success === false).length,
  };
};

const messageKey = (record: EditRecord): string =>
  `${record.sessionFile}::${record.assistantEntryId}`;

const modeStatsOf = (records: ReadonlyArray<EditRecord>): ReadonlyArray<ModeStats> =>
  ["single", "multi"].map((mode) => {
    const modeRecords = records.filter((record) => record.mode === mode);
    const { failed, resolved, success } = outcomeOf(modeRecords);
    return {
      mode,
      calls: modeRecords.length,
      resolved,
      success,
      failed,
      unresolved: modeRecords.length - resolved,
      successRate: resolved === 0 ? null : success / resolved,
      failureRate: resolved === 0 ? null : failed / resolved,
    };
  });

const lengthBucketsOf = (records: ReadonlyArray<EditRecord>): ReadonlyArray<LengthBucket> =>
  LENGTH_BUCKETS.map((bucket) => {
    const bucketRecords = records.filter(bucket.test);
    const { failed, resolved, success } = outcomeOf(bucketRecords);
    return {
      key: bucket.key,
      label: bucket.label,
      calls: bucketRecords.length,
      resolved,
      success,
      failed,
      unresolved: bucketRecords.length - resolved,
      successRate: resolved === 0 ? null : success / resolved,
      failureRate: resolved === 0 ? null : failed / resolved,
    };
  });

const inflationBucketsOf = (records: ReadonlyArray<EditRecord>): ReadonlyArray<InflationBucket> =>
  INFLATION_BUCKETS.map((bucket) => {
    const bucketRecords = records.filter(bucket.test);
    const { failed, resolved } = outcomeOf(bucketRecords);
    return {
      key: bucket.key,
      label: bucket.label,
      count: bucketRecords.length,
      resolved,
      failed,
      failureRate: resolved === 0 ? null : failed / resolved,
    };
  });

const hugeReplacementsOf = (records: ReadonlyArray<EditRecord>): ReadonlyArray<Threshold> =>
  HUGE_THRESHOLDS.map((threshold) => ({
    threshold,
    count: records.filter((record) => record.totalEditBytes > threshold).length,
  }));

const pathologicalOf = (records: ReadonlyArray<EditRecord>): ReadonlyArray<Threshold> =>
  PATHOLOGICAL_THRESHOLDS.map((threshold) => ({
    threshold,
    count: records.filter(
      (record) => record.inflationRatio !== null && record.inflationRatio >= threshold,
    ).length,
  }));

const clusterStatsOf = (records: ReadonlyArray<EditRecord>): ClusterStats => {
  const groups = Map.groupBy(records, (record) => `${messageKey(record)}::${record.path}`);
  const clusters = [...groups.values()].filter((group) => group.length >= 2);
  const withCluster = new Set(
    clusters.flatMap((group) => (group[0] === undefined ? [] : [messageKey(group[0])])),
  );
  const withMultiEdit = new Set(
    records
      .filter((record) => record.mode === "multi" && record.editsCount > 1)
      .map((record) => messageKey(record)),
  );
  const callsInsideClusters = clusters.reduce((sum, group) => sum + group.length, 0);
  return {
    clustersCount: clusters.length,
    assistantMessagesWithCluster: withCluster.size,
    assistantMessagesWithMultiEdit: withMultiEdit.size,
    callsInsideClusters,
    averageCallsPerCluster: clusters.length === 0 ? null : callsInsideClusters / clusters.length,
    ratioClusterAssistantMessagesToMultiEditAssistantMessages:
      withMultiEdit.size === 0 ? null : withCluster.size / withMultiEdit.size,
  };
};

const inflationScore = (record: EditRecord): number =>
  record.inflationRatio === null ? Number.POSITIVE_INFINITY : record.inflationRatio;

const worstExampleOf = (record: EditRecord): WorstExample => ({
  providerModel: record.providerModel,
  extension: record.extension,
  path: record.path,
  inflationRatio: record.inflationRatio,
  totalEditBytes: record.totalEditBytes,
  coreBytes: record.coreBytes,
  mode: record.mode,
  editsCount: record.editsCount,
  failed: record.success === false,
  errorKind: record.errorKind,
  sessionFile: record.sessionFile,
});

const worstExamplesOf = (options: {
  readonly records: ReadonlyArray<EditRecord>;
  readonly top: number;
}): ReadonlyArray<WorstExample> =>
  [...options.records]
    .sort((left, right) => {
      const leftScore = inflationScore(left);
      const rightScore = inflationScore(right);
      if (leftScore !== rightScore) return rightScore - leftScore;
      if (left.totalEditBytes !== right.totalEditBytes) {
        return right.totalEditBytes - left.totalEditBytes;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, options.top)
    .map(worstExampleOf);

export type {
  ClusterStats,
  InflationBucket,
  LengthBucket,
  ModeStats,
  Outcome,
  Threshold,
  WorstExample,
};
export {
  clusterStatsOf,
  hugeReplacementsOf,
  inflationBucketsOf,
  lengthBucketsOf,
  messageKey,
  modeStatsOf,
  outcomeOf,
  pathologicalOf,
  worstExamplesOf,
};
