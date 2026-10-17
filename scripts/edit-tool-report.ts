import type { EditGroupStats, EditSummary } from "./edit-tool-summary.ts";
import { formatInt, formatPercent } from "./stats-format.ts";

const formatRatio = (value: number | null): string => {
  if (value === null) return "no-core-change";
  if (!Number.isFinite(value)) return "∞";
  if (value >= 100) return `${value.toFixed(0)}x`;
  if (value >= 10) return `${value.toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
};

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
};

const rate = (part: number, total: number, value: number | null): string =>
  value === null ? "n/a" : formatPercent(part, total).padStart(6);

const filterLine = (summary: EditSummary): ReadonlyArray<string> => {
  const { filters } = summary;
  const parts = [
    ...(filters.model === null || filters.model === ""
      ? []
      : [`model contains "${filters.model}"`]),
    ...(filters.extension === null || filters.extension === ""
      ? []
      : [`extension = ${filters.extension}`]),
    ...(filters.failedOnly ? ["failed only"] : []),
  ];
  return parts.length === 0 ? [] : [`Filters: ${parts.join(", ")}`];
};

const headerLines = (summary: EditSummary): ReadonlyArray<string> => {
  const { counts, scan } = summary;
  return [
    `Scanned ${formatInt(scan.sessionFilesIncluded)} session files in ${scan.sessionsDir}`,
    ...(scan.since === null
      ? []
      : [
          `Session filter: files created at or after ${scan.since.iso} (${scan.since.source})`,
          `Skipped older session files: ${formatInt(scan.sessionFilesSkippedOlderThanSince)} of ${formatInt(scan.sessionFilesScanned)}`,
        ]),
    `Found ${formatInt(counts.totalEditCalls)} edit tool calls in ${formatInt(counts.assistantMessagesWithEditCalls)} assistant messages`,
    ...filterLine(summary),
    "",
    "Success rate",
    `  success:    ${formatInt(counts.success)}  ${formatPercent(counts.success, counts.resolvedEditCalls)}`,
    `  failed:     ${formatInt(counts.failed)}  ${formatPercent(counts.failed, counts.resolvedEditCalls)}`,
    `  unresolved: ${formatInt(counts.unresolved)}`,
    "",
    "Mode usage",
    `  single replacement: ${formatInt(counts.single)}  ${formatPercent(counts.single, counts.totalEditCalls)}`,
    `  multi-edit (edits): ${formatInt(counts.multi)}  ${formatPercent(counts.multi, counts.totalEditCalls)}`,
  ];
};

const modeLines = (summary: EditSummary): ReadonlyArray<string> => [
  "",
  "Failures by edit type",
  ...summary.modeStats.map(
    (mode) =>
      `  ${mode.mode.padEnd(6)} calls=${formatInt(mode.calls).padStart(4)} success=${rate(mode.success, mode.resolved, mode.successRate)} failed=${rate(mode.failed, mode.resolved, mode.failureRate)} unresolved=${formatInt(mode.unresolved)}`,
  ),
  "",
  "Multi-edit bucket split",
  ...summary.multiEditLengthBuckets.map(
    (bucket) =>
      `  ${bucket.label.padEnd(20)} ${formatInt(bucket.calls).padStart(4)} calls  success=${rate(bucket.success, bucket.resolved, bucket.successRate)} failed=${rate(bucket.failed, bucket.resolved, bucket.failureRate)}`,
  ),
  "",
  "Argument style",
  ...summary.argStyles.map(
    (entry) =>
      `  ${entry.style.padEnd(22)} ${formatInt(entry.count).padStart(8)}  ${formatPercent(entry.count, summary.counts.totalEditCalls)}`,
  ),
];

const providerBlock = (group: EditGroupStats): string =>
  [
    `  ${group.key}`,
    `    calls: ${formatInt(group.calls)}`,
    `    success: ${group.successRate === null ? "n/a" : formatPercent(group.success, group.resolved)}`,
    `    multi-edit: ${group.multiRate === null ? "n/a" : formatPercent(group.multi, group.calls)}`,
    `    median inflation: ${formatRatio(group.medianInflation)}`,
    `    p95 inflation: ${formatRatio(group.p95Inflation)}`,
  ].join("\n");

const extensionLine = (group: EditGroupStats): string =>
  `  ${group.key.padEnd(10)} calls=${formatInt(group.calls).padStart(6)}  success=${group.successRate === null ? "n/a" : formatPercent(group.success, group.resolved).padStart(6)}  medianInflation=${formatRatio(group.medianInflation)}`;

const groupTable = (
  title: string,
  groups: ReadonlyArray<EditGroupStats>,
  formatter: (group: EditGroupStats) => string,
): ReadonlyArray<string> =>
  groups.length === 0 ? [] : ["", title, ...groups.map((group) => formatter(group))];

const inflationLines = (summary: EditSummary): ReadonlyArray<string> => {
  const { counts, inflation } = summary;
  return [
    "",
    "Context inflation",
    `  median inflation: ${formatRatio(inflation.median)}`,
    `  p90 inflation:    ${formatRatio(inflation.p90)}`,
    `  p95 inflation:    ${formatRatio(inflation.p95)}`,
    `  p99 inflation:    ${formatRatio(inflation.p99)}`,
    `  no-core-change:   ${formatInt(counts.noCoreChange)}`,
    "",
    "Huge replacements",
    ...inflation.hugeReplacements.map(
      (entry) =>
        `  >${formatBytes(entry.threshold).padEnd(6)} ${formatInt(entry.count).padStart(8)}`,
    ),
    "",
    "Pathological wrappers",
    ...inflation.pathologicalThresholds.map(
      (entry) =>
        `  inflation >= ${String(entry.threshold).padEnd(3)}x ${formatInt(entry.count).padStart(8)}`,
    ),
  ];
};

const clusterLines = (summary: EditSummary): ReadonlyArray<string> => {
  const clusters = summary.sameFileClusters;
  const ratio = clusters.ratioClusterAssistantMessagesToMultiEditAssistantMessages;
  return [
    "",
    "Same-file multi-call behavior",
    `  assistant msgs with 2+ edit calls to same file: ${formatInt(clusters.assistantMessagesWithCluster)}`,
    `  total same-file clusters:                      ${formatInt(clusters.clustersCount)}`,
    `  calls inside those clusters:                  ${formatInt(clusters.callsInsideClusters)}`,
    `  average calls per cluster:                    ${clusters.averageCallsPerCluster === null ? "n/a" : clusters.averageCallsPerCluster.toFixed(2)}`,
    `  assistant msgs using one multi-edit call:     ${formatInt(clusters.assistantMessagesWithMultiEdit)}`,
    `  ratio multi-call / multi-edit assistant msgs: ${ratio === null ? "n/a" : ratio.toFixed(2)}`,
  ];
};

const failureLines = (summary: EditSummary): ReadonlyArray<string> => [
  "",
  "Failures by kind",
  ...(summary.failureKinds.length === 0
    ? ["  none"]
    : summary.failureKinds.map(
        (failure) => `  ${failure.kind.padEnd(22)} ${formatInt(failure.count).padStart(8)}`,
      )),
  "",
  "Failure rate by inflation bucket",
  ...summary.inflation.failureByBucket.map(
    (bucket) =>
      `  ${bucket.label.padEnd(14)} ${rate(bucket.failed, bucket.resolved, bucket.failureRate)}  (${formatInt(bucket.count)} calls)`,
  ),
];

const exampleLines = (summary: EditSummary): ReadonlyArray<string> => [
  "",
  `Worst ${formatInt(summary.worstExamples.length)} examples`,
  ...summary.worstExamples.flatMap((example, index) => [
    `  ${index + 1}. ${example.providerModel} ${example.extension} inflation=${formatRatio(example.inflationRatio)} failed=${example.failed ? example.errorKind : "false"}`,
    `     path: ${example.path}`,
    `     totalEditBytes=${formatBytes(example.totalEditBytes)} coreBytes=${formatBytes(example.coreBytes)} mode=${example.mode} edits=${example.editsCount}`,
  ]),
];

const parserNotes = (summary: EditSummary): ReadonlyArray<string> => {
  const { scan } = summary;
  if (scan.malformedLines === 0 && scan.unmatchedToolResults === 0) return [];
  return [
    "",
    "Parser notes",
    ...(scan.malformedLines > 0
      ? [`  malformed lines skipped: ${formatInt(scan.malformedLines)}`]
      : []),
    ...(scan.unmatchedToolResults > 0
      ? [`  unmatched edit tool results: ${formatInt(scan.unmatchedToolResults)}`]
      : []),
  ];
};

const buildEditTextReport = (summary: EditSummary): string =>
  [
    ...headerLines(summary),
    ...modeLines(summary),
    ...groupTable("By provider/model", summary.providerStats, providerBlock),
    ...groupTable("By file extension", summary.extensionStats, extensionLine),
    ...inflationLines(summary),
    ...clusterLines(summary),
    ...failureLines(summary),
    ...exampleLines(summary),
    ...parserNotes(summary),
  ].join("\n");

export { buildEditTextReport };
