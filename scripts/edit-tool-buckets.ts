import type editToolBucketsTypes from "./edit-tool-buckets.types.ts";
import type editToolScanTypes from "./edit-tool-scan.types.ts";

const LENGTH_BUCKETS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly test: (record: editToolScanTypes.EditRecord) => boolean;
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
  readonly test: (record: editToolScanTypes.EditRecord) => boolean;
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

const outcomeOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): editToolBucketsTypes.Outcome => {
  const resolved = records.filter((record) => record.success !== null);
  return {
    failed: resolved.filter((record) => record.success === false).length,
    resolved: resolved.length,
    success: resolved.filter((record) => record.success === true).length,
  };
};

const messageKey = (record: editToolScanTypes.EditRecord): string =>
  `${record.sessionFile}::${record.assistantEntryId}`;

const modeStatsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): ReadonlyArray<editToolBucketsTypes.ModeStats> =>
  ["single", "multi"].map((mode) => {
    const modeRecords = records.filter((record) => record.mode === mode);
    const { failed, resolved, success } = outcomeOf(modeRecords);
    return {
      calls: modeRecords.length,
      failed,
      failureRate: resolved === 0 ? null : failed / resolved,
      mode,
      resolved,
      success,
      successRate: resolved === 0 ? null : success / resolved,
      unresolved: modeRecords.length - resolved,
    };
  });

const lengthBucketsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): ReadonlyArray<editToolBucketsTypes.LengthBucket> =>
  LENGTH_BUCKETS.map((bucket) => {
    const bucketRecords = records.filter(bucket.test);
    const { failed, resolved, success } = outcomeOf(bucketRecords);
    return {
      calls: bucketRecords.length,
      failed,
      failureRate: resolved === 0 ? null : failed / resolved,
      key: bucket.key,
      label: bucket.label,
      resolved,
      success,
      successRate: resolved === 0 ? null : success / resolved,
      unresolved: bucketRecords.length - resolved,
    };
  });

const inflationBucketsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): ReadonlyArray<editToolBucketsTypes.InflationBucket> =>
  INFLATION_BUCKETS.map((bucket) => {
    const bucketRecords = records.filter(bucket.test);
    const { failed, resolved } = outcomeOf(bucketRecords);
    return {
      count: bucketRecords.length,
      failed,
      failureRate: resolved === 0 ? null : failed / resolved,
      key: bucket.key,
      label: bucket.label,
      resolved,
    };
  });

const hugeReplacementsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): ReadonlyArray<editToolBucketsTypes.Threshold> =>
  HUGE_THRESHOLDS.map((threshold) => ({
    count: records.filter((record) => record.totalEditBytes > threshold).length,
    threshold,
  }));

const pathologicalOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): ReadonlyArray<editToolBucketsTypes.Threshold> =>
  PATHOLOGICAL_THRESHOLDS.map((threshold) => ({
    count: records.filter(
      (record) => record.inflationRatio !== null && record.inflationRatio >= threshold,
    ).length,
    threshold,
  }));

const clusterStatsOf = (
  records: ReadonlyArray<editToolScanTypes.EditRecord>,
): editToolBucketsTypes.ClusterStats => {
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
    assistantMessagesWithCluster: withCluster.size,
    assistantMessagesWithMultiEdit: withMultiEdit.size,
    averageCallsPerCluster: clusters.length === 0 ? null : callsInsideClusters / clusters.length,
    callsInsideClusters,
    clustersCount: clusters.length,
    ratioClusterAssistantMessagesToMultiEditAssistantMessages:
      withMultiEdit.size === 0 ? null : withCluster.size / withMultiEdit.size,
  };
};

const inflationScore = (record: editToolScanTypes.EditRecord): number =>
  record.inflationRatio === null ? Number.POSITIVE_INFINITY : record.inflationRatio;

const worstExampleOf = (
  record: editToolScanTypes.EditRecord,
): editToolBucketsTypes.WorstExample => ({
  coreBytes: record.coreBytes,
  editsCount: record.editsCount,
  errorKind: record.errorKind,
  extension: record.extension,
  failed: record.success === false,
  inflationRatio: record.inflationRatio,
  mode: record.mode,
  path: record.path,
  providerModel: record.providerModel,
  sessionFile: record.sessionFile,
  totalEditBytes: record.totalEditBytes,
});

const worstExamplesOf = (options: {
  readonly records: ReadonlyArray<editToolScanTypes.EditRecord>;
  readonly top: number;
}): ReadonlyArray<editToolBucketsTypes.WorstExample> =>
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

const editToolBuckets = {
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

export default editToolBuckets;
