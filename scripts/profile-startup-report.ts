import { Function } from "effect";

interface RunResult {
  readonly elapsedMs: number;
  readonly profilePath: string | undefined;
  readonly timings: ReadonlyMap<string, number>;
}

interface Summary {
  readonly avg: number;
  readonly max: number;
  readonly median: number;
  readonly min: number;
}

interface ReportContext {
  readonly cpuProfile: boolean;
  readonly displayPath: (path: string) => string;
  readonly mode: string;
  readonly profileDir: string;
  readonly runtimeLabel: string;
}

const TIMINGS_HEADER = /^--- Startup Timings(?:: [^-]+)? ---$/u;
const TIMING_LINE = /^\s+([^:]+):\s+(\d+)ms$/u;
const LINE_BREAK = /\r?\n/u;
const NON_ALNUM = /[^a-zA-Z0-9]+/gu;
const EDGE_UNDERSCORES = /^_+|_+$/gu;

const formatMs = (value: number): string => `${value.toFixed(1)}ms`;

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

const parseStartupTimings = (stderr: string): ReadonlyMap<string, number> => {
  const timings = new Map<string, number>();
  let inBlock = false;
  for (const line of stderr.split(LINE_BREAK)) {
    if (TIMINGS_HEADER.test(line.trim())) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line.includes("------------------------")) break;
    const match = TIMING_LINE.exec(line);
    const label = match?.[1];
    const value = match?.[2];
    if (label !== undefined && value !== undefined) timings.set(label, Number.parseInt(value, 10));
  }
  return timings;
};

const summarizeTimingMaps = (runs: ReadonlyArray<RunResult>): ReadonlyMap<string, Summary> => {
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

const slowestRun = (runs: ReadonlyArray<RunResult>): RunResult | undefined =>
  runs.reduce<RunResult | undefined>(
    (slowest, run) => (slowest === undefined || run.elapsedMs > slowest.elapsedMs ? run : slowest),
    undefined,
  );

const profileLines = (context: ReportContext, runs: ReadonlyArray<RunResult>) => {
  const profilePath = slowestRun(runs)?.profilePath;
  if (!context.cpuProfile || profilePath === undefined || profilePath === "") return [];
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

const singleRunReport = (context: ReportContext, run: RunResult): ReadonlyArray<string> => {
  const timings = summarizeTimingMaps([run]);
  return [
    "\nResult",
    `  runtime:          ${context.runtimeLabel}`,
    `  mode:             ${context.mode}`,
    `  elapsed:          ${formatMs(run.elapsedMs)}`,
    ...[...timings.entries()].map(([label, summary]) => `  ${label}: ${formatMs(summary.median)}`),
    ...profileLines(context, [run]),
    ...metricLines(run.elapsedMs, timings),
  ];
};

const multiRunReport = (
  context: ReportContext,
  runs: ReadonlyArray<RunResult>,
): ReadonlyArray<string> => {
  const elapsed = summarize(runs.map((run) => run.elapsedMs));
  const timings = summarizeTimingMaps(runs);
  return [
    "\nSummary",
    `  runtime:          ${context.runtimeLabel}`,
    `  mode:             ${context.mode}`,
    `  elapsed min:      ${formatMs(elapsed.min)}`,
    `  elapsed median:   ${formatMs(elapsed.median)}`,
    `  elapsed avg:      ${formatMs(elapsed.avg)}`,
    `  elapsed max:      ${formatMs(elapsed.max)}`,
    ...[...timings.entries()].map(
      ([label, summary]) => `  ${label} median: ${formatMs(summary.median)}`,
    ),
    ...profileLines(context, runs),
    ...metricLines(elapsed.median, timings),
  ];
};

const buildReport: {
  (runs: ReadonlyArray<RunResult>): (context: ReportContext) => ReadonlyArray<string>;
  (context: ReportContext, runs: ReadonlyArray<RunResult>): ReadonlyArray<string>;
} = Function.dual(2, (context: ReportContext, runs: ReadonlyArray<RunResult>) => {
  const [first] = runs;
  if (first === undefined) return ["\nNo measured runs requested."];
  return runs.length === 1 ? singleRunReport(context, first) : multiRunReport(context, runs);
});

export type { ReportContext, RunResult };
export { buildReport, formatMs, parseStartupTimings };
