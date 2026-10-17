import { homedir, tmpdir } from "node:os";

import { Console, Data, DateTime, Effect } from "effect";

import { openBrowser } from "../apps/coding-agent/src/utils/open-browser.ts";
import { helpOptions, ignoreUnknown, parseOptions, valueOption } from "./cli-options.ts";
import type { CliOption } from "./cli-options.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { jsonlFilesRecursive, requireSessionsDir } from "./sessions.ts";
import { renderReport } from "./tool-stats-report.ts";
import type { HistogramRow } from "./tool-stats-report.ts";
import { scanToolUsage } from "./tool-stats-scan.ts";
import type { BashCommandStats, ToolStats } from "./tool-stats-scan.ts";

interface Args {
  output: string;
  sessionsDir: string;
}

class ToolStatsError extends Data.TaggedError("ToolStatsError")<{
  readonly message: string;
}> {}

const BUCKETS: ReadonlyArray<number> = [
  0,
  50,
  100,
  250,
  500,
  1000,
  2000,
  4000,
  8000,
  16_000,
  32_000,
  Number.POSITIVE_INFINITY,
];

const HELP = "Usage: scripts/tool-stats.ts [--sessions-dir <dir>] [--output <file.html>]";

const nonEmptyValue = (set: (parsed: Args, value: string) => void): CliOption<Args, never> =>
  valueOption((parsed, value) =>
    Effect.sync(() => {
      if (value !== undefined && value !== "") set(parsed, value);
    }),
  );

const toolStatsOptions = (host: HostShape): ReadonlyMap<string, CliOption<Args, never>> => {
  const output = nonEmptyValue((parsed, value) => {
    parsed.output = host.resolve(value);
  });
  return new Map<string, CliOption<Args, never>>([
    [
      "--sessions-dir",
      nonEmptyValue((parsed, value) => {
        parsed.sessionsDir = host.resolve(value);
      }),
    ],
    ["--output", output],
    ["-o", output],
    ...helpOptions(HELP),
  ]);
};

const parseArgs = (host: HostShape) =>
  parseOptions({
    args: process.argv.slice(2),
    options: toolStatsOptions(host),
    parsed: {
      output: host.join(tmpdir(), "msa-tool-stats.html"),
      sessionsDir: host.join(homedir(), ".msa", "agent", "sessions"),
    },
    unknown: ignoreUnknown,
  });

const bucketCounts = (samples: ReadonlyArray<number>): ReadonlyArray<number> => {
  const counts: Array<number> = Array.from({ length: BUCKETS.length - 1 }, () => 0);
  for (const sample of samples) {
    const index = BUCKETS.findIndex((max, position) => position > 0 && sample <= max) - 1;
    const bucket = Math.max(0, index);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
};

const bucketLabels = (): ReadonlyArray<string> =>
  BUCKETS.slice(0, -1).map((min, index) => {
    const max = BUCKETS[index + 1];
    return max !== undefined && Number.isFinite(max) ? `${min}-${max}` : `${min}+`;
  });

const toolRowsOf = (tools: Map<string, ToolStats>): ReadonlyArray<HistogramRow> =>
  [...tools.entries()]
    .map(([name, stats]) => ({
      name,
      calls: stats.calls,
      results: stats.results,
      estimatedTokens: stats.estimatedTokens,
      samples: stats.samples,
      errors: stats.errors,
      avg: stats.results > 0 ? stats.estimatedTokens / stats.results : 0,
      histogram: bucketCounts(stats.samples),
    }))
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens);

const bashRowsOf = (bashCommands: Map<string, BashCommandStats>): ReadonlyArray<HistogramRow> =>
  [...bashCommands.entries()]
    .map(([name, stats]) => ({
      name,
      calls: stats.calls,
      estimatedTokens: stats.estimatedTokens,
      samples: stats.samples,
      avg: stats.samples.length > 0 ? stats.estimatedTokens / stats.samples.length : 0,
      histogram: bucketCounts(stats.samples),
    }))
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens)
    .slice(0, 50);

const program = Effect.gen(function* () {
  const host = yield* Host;
  const { output, sessionsDir } = yield* parseArgs(host);
  yield* requireSessionsDir({
    fail: (message) => new ToolStatsError({ message }),
    host,
    sessionsDir,
  });
  const files = yield* jsonlFilesRecursive({ directory: sessionsDir, host });
  const aggregate = yield* scanToolUsage({ files, host });
  const html = yield* renderReport({
    bashCommands: bashRowsOf(aggregate.bashCommands),
    bucketLabels: bucketLabels(),
    files: files.length,
    generatedAt: DateTime.formatIso(yield* DateTime.now),
    parseErrors: aggregate.parseErrors,
    sessionsDir,
    tools: toolRowsOf(aggregate.tools),
  });
  yield* host.makeDirectory(host.resolve(output, ".."));
  yield* host.writeText(output, html);
  yield* Console.log(`Wrote ${output}`);
  yield* Effect.sync(() => openBrowser(output));
});

runScript(program);
