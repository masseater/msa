import { Clock, Effect, Function } from "effect";

import type profileStartupReportTypes from "./profile-startup-report.types.ts";

interface Summary {
  readonly avg: number;
  readonly max: number;
  readonly median: number;
  readonly min: number;
}

const TIMINGS_HEADER = /^--- Startup Timings(?:: [^-]+)? ---$/u;
const TIMING_LINE = /^\s+([^:]+):\s+(\d+)ms$/u;
const LINE_BREAK = /\r?\n/u;
const NON_ALNUM = /[^a-zA-Z0-9]+/gu;
const EDGE_UNDERSCORES = /^_+|_+$/gu;

const formatMs = (value: number): string => `${value.toFixed(1)}ms`;

const nowMs = Effect.map(Clock.currentTimeNanos, (nanos) => Number(nanos) / 1_000_000);

const summarize = (values: ReadonlyArray<number>): Summary => {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const at = (index: number) => sorted[index] ?? Number.NaN;
  return {
    avg: total / sorted.length,
    max: at(sorted.length - 1),
    median: sorted.length % 2 === 0 ? (at(middle - 1) + at(middle)) / 2 : at(middle),
    min: at(0),
  };
};

const timingBlock = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const start = lines.findIndex((line) => TIMINGS_HEADER.test(line.trim()));
  if (start === -1) return [];
  const block = lines.slice(start + 1);
  const end = block.findIndex((line) => line.includes("------------------------"));
  return end === -1 ? block : block.slice(0, end);
};

const timingEntry = (line: string): ReadonlyArray<readonly [string, number]> => {
  const match = TIMING_LINE.exec(line);
  if (match === null) return [];
  const [, label, value] = match;
  return label === undefined || value === undefined ? [] : [[label, Number.parseInt(value, 10)]];
};

const parseStartupTimings = (stderr: string): ReadonlyMap<string, number> =>
  new Map(timingBlock(stderr.split(LINE_BREAK)).flatMap(timingEntry));

const summarizeTimingMaps = (
  runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
): ReadonlyMap<string, Summary> => {
  const valuesByLabel = new Map<string, Array<number>>();
  for (const run of runs) {
    for (const [label, value] of run.timings.entries()) {
      const values = valuesByLabel.get(label);
      if (values === undefined) valuesByLabel.set(label, [value]);
      else values.push(value);
    }
  }
  return new Map([...valuesByLabel.entries()].map(([label, values]) => [label, summarize(values)]));
};

const toMetricName = (label: string): string =>
  `${label.replaceAll(NON_ALNUM, "_").replaceAll(EDGE_UNDERSCORES, "")}_ms`;

const slowestRun = (
  runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
): profileStartupReportTypes.RunResult | undefined =>
  runs.reduce<profileStartupReportTypes.RunResult | undefined>(
    (slowest, run) => (slowest === undefined || run.elapsedMs > slowest.elapsedMs ? run : slowest),
    undefined,
  );

const selectedProfilePath = (
  context: profileStartupReportTypes.ReportContext,
  runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
): string | undefined => {
  const profilePath = slowestRun(runs)?.profilePath;
  return context.cpuProfile && profilePath !== "" ? profilePath : undefined;
};

const profileLines = (
  context: profileStartupReportTypes.ReportContext,
  runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
) => {
  const profilePath = selectedProfilePath(context, runs);
  if (profilePath === undefined) return [];
  return [
    `  selected profile: ${context.displayPath(profilePath)}`,
    `  profiles dir:     ${context.displayPath(context.profileDir)}`,
  ];
};

const metricLines = (startupMs: number, timings: ReadonlyMap<string, Summary>) => [
  `METRIC startup_time_ms=${startupMs.toFixed(1)}`,
  ...[...timings.entries()].map(
    ([label, summary]) => `METRIC ${toMetricName(label)}=${summary.median.toFixed(1)}`,
  ),
];

const reportLines = (
  heading: string,
  context: profileStartupReportTypes.ReportContext,
  runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
  elapsedLines: ReadonlyArray<string>,
  labelSuffix: string,
  startupMs: number,
) => {
  const timings = summarizeTimingMaps(runs);
  return [
    heading,
    `  runtime:          ${context.runtimeLabel}`,
    `  mode:             ${context.mode}`,
    ...elapsedLines,
    ...[...timings.entries()].map(
      ([label, summary]) => `  ${label}${labelSuffix}: ${formatMs(summary.median)}`,
    ),
    ...profileLines(context, runs),
    ...metricLines(startupMs, timings),
  ];
};

const singleRunReport = (
  context: profileStartupReportTypes.ReportContext,
  run: profileStartupReportTypes.RunResult,
): ReadonlyArray<string> =>
  reportLines(
    "\nResult",
    context,
    [run],
    [`  elapsed:          ${formatMs(run.elapsedMs)}`],
    "",
    run.elapsedMs,
  );

const multiRunReport = (
  context: profileStartupReportTypes.ReportContext,
  runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
): ReadonlyArray<string> => {
  const elapsed = summarize(runs.map((run) => run.elapsedMs));
  return reportLines(
    "\nSummary",
    context,
    runs,
    [
      `  elapsed min:      ${formatMs(elapsed.min)}`,
      `  elapsed median:   ${formatMs(elapsed.median)}`,
      `  elapsed avg:      ${formatMs(elapsed.avg)}`,
      `  elapsed max:      ${formatMs(elapsed.max)}`,
    ],
    " median",
    elapsed.median,
  );
};

const buildReport: {
  (
    runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
  ): (context: profileStartupReportTypes.ReportContext) => ReadonlyArray<string>;
  (
    context: profileStartupReportTypes.ReportContext,
    runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
  ): ReadonlyArray<string>;
} = Function.dual(
  2,
  (
    context: profileStartupReportTypes.ReportContext,
    runs: ReadonlyArray<profileStartupReportTypes.RunResult>,
  ) => {
    const [first] = runs;
    if (first === undefined) return ["\nNo measured runs requested."];
    return runs.length === 1 ? singleRunReport(context, first) : multiRunReport(context, runs);
  },
);

const profileStartupReport = {
  buildReport,
  formatMs,
  nowMs,
  parseStartupTimings,
};

export default profileStartupReport;
