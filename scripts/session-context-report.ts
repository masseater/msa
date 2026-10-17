import type { GroupSummary, Summary } from "./session-context-summary.ts";

const CHART_WIDTH = 40;

const formatInt = (value: number): string =>
  new Intl.NumberFormat("en-US").format(Math.round(value));

const formatNumber = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : "n/a");

const formatPercent = (value: number): string =>
  Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";

const bar = (percent: number): string => {
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const filled = Math.round((clamped / 100) * CHART_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(CHART_WIDTH - filled)}`;
};

const optionalInt = (value: number | null, width: number): string =>
  value === null ? "n/a" : formatInt(value).padStart(width);

const optionalPercent = (value: number | null, width: number): string =>
  value === null ? "n/a" : formatPercent(value).padStart(width);

const groupCells = (group: GroupSummary): ReadonlyArray<string> => [
  `sessions=${formatInt(group.sessions).padStart(4)}`,
  `avgTurns=${formatNumber(group.avgTurns).padStart(5)}`,
  `avgMin=${formatNumber(group.avgDurationMinutes).padStart(6)}`,
  `avgMaxTok=${optionalInt(group.avgMaxPromptTokens, 7)}`,
  `medMaxCtx=${optionalPercent(group.medianMaxContextUsagePercent, 6)}`,
  `medPreCompactCtx=${optionalPercent(group.medianPreFirstCompactionUsagePercent, 6)}`,
  `avgCtx=${optionalPercent(group.avgMaxContextUsagePercent, 6)}`,
  `compact=${formatPercent(group.compactionRate).padStart(6)}`,
  `over90=${formatInt(group.over90).padStart(3)}`,
  bar(group.medianMaxContextUsagePercent ?? 0),
];

const lineForGroup = (group: GroupSummary, indent = "  "): string =>
  `${indent}${group.key} ${groupCells(group).join(" ")}`;

const METHOD_NOTE =
  "Context usage parses full session JSONL files. max context uses max assistant usage.totalTokens per session, falling back to input + output + cacheRead + cacheWrite, plus compaction tokensBefore. medPreCompactCtx uses the last assistant usage before the first compaction, or the first compaction tokensBefore when present, divided by model contextWindow from libs/ai/src/models.generated.ts when known.";

const isPresent = (value: string | null): value is string => value !== null && value !== "";

const FILTER_LINES: ReadonlyArray<(filters: Summary["filters"]) => string | null> = [
  (filters) => (isPresent(filters.model) ? `Filters: model contains "${filters.model}"` : null),
  (filters) =>
    filters.modelPrefixes.length > 0
      ? `Filters: model prefixes = ${filters.modelPrefixes.join(", ")}`
      : null,
  (filters) =>
    filters.bashContains.length > 0
      ? `Filters: bash contains any of = ${filters.bashContains.join(", ")}`
      : null,
  (filters) => (isPresent(filters.cwd) ? `Filters: cwd = ${filters.cwd}` : null),
];

const filterLines = (summary: Summary): ReadonlyArray<string> =>
  FILTER_LINES.flatMap((line) => {
    const text = line(summary.filters);
    return text === null ? [] : [text];
  });

const modelDayLines = (summary: Summary): ReadonlyArray<string> =>
  summary.byModelDay.flatMap((model) => [
    "",
    `${model.key} contextWindow=${
      model.contextWindows.length === 0
        ? "unknown"
        : model.contextWindows.map((value) => formatInt(value)).join(", ")
    }`,
    lineForGroup(model, "  total "),
    ...model.byDay.map((group) => lineForGroup(group)),
  ]);

const buildTextReport = (summary: Summary): string => {
  const lines: Array<string> = [
    `Scanned ${formatInt(summary.scan.sessionFilesIncluded)} session files in ${summary.scan.sessionsDir}`,
    `Report timezone: ${summary.scan.timezone} (CET/CEST)`,
    `Context window sources: ${summary.scan.contextWindowSources.join(", ") || "none"}`,
    ...filterLines(summary),
    METHOD_NOTE,
    "",
    "Totals",
    lineForGroup(summary.totals),
    "",
    "By day",
    ...summary.byDay.map((group) => lineForGroup(group)),
    "",
    "By model",
    ...summary.byModel.map((group) => lineForGroup(group)),
    "",
    "By model, then by day",
    ...modelDayLines(summary),
  ];
  if (summary.scan.malformedLines > 0) {
    lines.push("", `Malformed lines skipped: ${formatInt(summary.scan.malformedLines)}`);
  }
  return `${lines.join("\n")}\n`;
};

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const buildHtmlReport = (summary: Summary): string => `<!doctype html>
<meta charset="utf-8">
<title>Session context stats</title>
<style>
body { margin: 24px; background: #fff; color: #111; }
pre { font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; }
</style>
<pre>${escapeHtml(buildTextReport(summary))}</pre>`;

export { buildHtmlReport, buildTextReport };
