import htmlDocumentModule from "../libs/ai/src/utils/html-document.ts";
import type htmlDocumentTypes from "../libs/ai/src/utils/html-document.types.ts";
import type readToolSummaryTypes from "./read-tool-summary.types.ts";
import reportZoneModule from "./report-zone.ts";
import statsFormat from "./stats-format.ts";

const { escapeHtml, htmlDocument } = htmlDocumentModule;

const { formatInt, formatPercent } = statsFormat;
const { REPORT_TIME_ZONE } = reportZoneModule;

const CHART_WIDTH = 40;

const REPORT_STYLE = `body { margin: 24px; background: #fff; color: #111; }
pre { font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; }`;

const formatRate = (value: number | null): string =>
  value !== null && Number.isFinite(value) ? value.toFixed(2) : "n/a";

const bar = (part: number, total: number): string => {
  const filled = total === 0 ? 0 : Math.round((part / total) * CHART_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(CHART_WIDTH - filled)}`;
};

const groupLine = (group: readToolSummaryTypes.GroupStats, indent: string): string =>
  `${indent}${group.key} reads=${formatInt(group.reads).padStart(5)} full=${formatPercent(group.full, group.reads).padStart(6)} partial=${formatPercent(group.partial, group.reads).padStart(6)} ${bar(group.partial, group.reads)}`;

const normalizedLine = (group: readToolSummaryTypes.NormalizedStats, indent: string): string =>
  `${indent}${group.key} sessions=${formatInt(group.sessions).padStart(4)} reads/session=${formatRate(group.readsPerSession).padStart(5)} full/session=${formatRate(group.fullPerSession).padStart(5)} partial/session=${formatRate(group.partialPerSession).padStart(5)} medianSessionPartial=${group.medianSessionPartialRate === null ? "n/a" : formatPercent(group.medianSessionPartialRate, 1).padStart(6)} ${bar(group.medianSessionPartialRate ?? 0, 1)}`;

const headerLines = (summary: readToolSummaryTypes.ReadSummary): ReadonlyArray<string> => {
  const { counts, filters, scan } = summary;
  return [
    `Scanned ${formatInt(scan.sessionFilesIncluded)} session files in ${scan.sessionsDir}`,
    `Report timezone: ${REPORT_TIME_ZONE} (CET/CEST)`,
    ...(scan.since === null
      ? []
      : [
          `Session filter: files created at or after ${scan.since.iso} (${scan.since.source})`,
          `Skipped older session files: ${formatInt(scan.sessionFilesSkippedOlderThanSince)} of ${formatInt(scan.sessionFilesScanned)}`,
        ]),
    `Found ${formatInt(counts.totalReadCalls)} read tool calls in ${formatInt(counts.assistantMessagesWithReadCalls)} assistant messages`,
    ...(filters.model === null || filters.model === ""
      ? []
      : [`Filters: model contains "${filters.model}"`]),
    "",
    "Full vs partial reads",
    `  full:    ${formatInt(counts.full).padStart(8)}  ${formatPercent(counts.full, counts.totalReadCalls).padStart(6)}  ${bar(counts.full, counts.totalReadCalls)}`,
    `  partial: ${formatInt(counts.partial).padStart(8)}  ${formatPercent(counts.partial, counts.totalReadCalls).padStart(6)}  ${bar(counts.partial, counts.totalReadCalls)}`,
  ];
};

const providerLines = (
  provider: readToolSummaryTypes.ProviderStats,
  bucket: string,
): ReadonlyArray<string> => [
  "",
  provider.providerModel,
  `  total reads=${formatInt(provider.reads)} assistantMessages=${formatInt(provider.assistantMessages)}`,
  `  total full    ${formatInt(provider.full).padStart(8)} ${formatPercent(provider.full, provider.reads).padStart(6)} ${bar(provider.full, provider.reads)}`,
  `  total partial ${formatInt(provider.partial).padStart(8)} ${formatPercent(provider.partial, provider.reads).padStart(6)} ${bar(provider.partial, provider.reads)}`,
  `  By ${bucket}`,
  ...provider.timeStats.map((group) => groupLine(group, "    ")),
  `  By ${bucket}, session-normalized`,
  ...provider.normalizedTimeStats.map((group) => normalizedLine(group, "    ")),
  "  By time of day",
  ...provider.timeOfDayStats.map((group) => groupLine(group, "    ")),
  "  By time of day, session-normalized",
  ...provider.normalizedTimeOfDayStats.map((group) => normalizedLine(group, "    ")),
];

const reportLines = (summary: readToolSummaryTypes.ReadSummary): ReadonlyArray<string> => {
  const bucket = summary.filters.bucket;
  return [
    ...headerLines(summary),
    "",
    `By ${bucket}`,
    ...summary.timeStats.map((group) => groupLine(group, "  ")),
    "",
    "By time of day",
    ...summary.timeOfDayStats.map((group) => groupLine(group, "  ")),
    "",
    "By time of day, session-normalized",
    ...summary.normalizedTimeOfDayStats.map((group) => normalizedLine(group, "  ")),
    "",
    `By ${bucket}, session-normalized`,
    ...summary.normalizedTimeStats.map((group) => normalizedLine(group, "  ")),
    "",
    `By provider/model, then by ${bucket}`,
    ...summary.timeStatsByProvider.flatMap((provider) => providerLines(provider, bucket)),
    ...(summary.scan.malformedLines > 0
      ? ["", "Parser notes", `  malformed lines skipped: ${formatInt(summary.scan.malformedLines)}`]
      : []),
  ];
};

const buildReadTextReport = (summary: readToolSummaryTypes.ReadSummary): string =>
  reportLines(summary).join("\n");

const buildReadHtmlReport = (
  summary: readToolSummaryTypes.ReadSummary,
): htmlDocumentTypes.HtmlDocument =>
  htmlDocument({
    body: `<pre>${escapeHtml(`${buildReadTextReport(summary)}\n`)}</pre>`,
    style: REPORT_STYLE,
    title: "Read tool stats",
  });

const readToolReport = {
  buildReadHtmlReport,
  buildReadTextReport,
};

export default readToolReport;
