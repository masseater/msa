import { homedir } from "node:os";

import { Console, Data, Effect, Schema } from "effect";

import { resolveSince } from "./auto-since.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { IndentedJson } from "./json.ts";
import { buildReadHtmlReport, buildReadTextReport } from "./read-tool-report.ts";
import { scanReadCalls } from "./read-tool-scan.ts";
import type { ReadRecord } from "./read-tool-scan.ts";
import { buildReadSummary } from "./read-tool-summary.ts";
import { reportZone } from "./report-zone.ts";

const DEFAULT_TOP = 20;

const HELP = `Usage: node scripts/read-tool-stats.ts [options]

Options:
  --sessions-dir <path>  Sessions directory (default: ~/.msa/agent/sessions)
  --model <substring>    Filter provider/model by substring
  --top <n>              Number of examples to show (default: ${DEFAULT_TOP})
  --since <iso>          Only scan session files created at or after this ISO time
  --all-sessions         Disable the automatic since filter
  --auto-since-path <p>  Use birth time of this file for the automatic since filter
  --bucket <day|week>    Time bucket for trend chart (default: week)
  --json                 Print JSON summary instead of HTML report
  --text                 Print plain text report instead of HTML
  --include-records      Include raw records in JSON output
  -h, --help             Show this help
`;

interface Args {
  allSessions: boolean;
  autoSincePath: string | undefined;
  bucket: "day" | "week";
  includeRecords: boolean;
  json: boolean;
  modelFilter: string | undefined;
  sessionsDir: string;
  since: string | undefined;
  text: boolean;
  top: number;
}

class ReadToolStatsError extends Data.TaggedError("ReadToolStatsError")<{
  readonly message: string;
}> {}

const VALUE_ARGS = new Set([
  "--auto-since-path",
  "--bucket",
  "--model",
  "--sessions-dir",
  "--since",
  "--top",
]);

const encodeIndentedJson = Schema.encodeEffect(IndentedJson);

const defaultArgs = (host: HostShape): Args => ({
  allSessions: false,
  autoSincePath: host.join(
    process.cwd(),
    "apps",
    "coding-agent",
    "src",
    "core",
    "tools",
    "read.ts",
  ),
  bucket: "week",
  includeRecords: false,
  json: false,
  modelFilter: undefined,
  sessionsDir: host.join(homedir(), ".msa", "agent", "sessions"),
  since: undefined,
  text: false,
  top: DEFAULT_TOP,
});

const applyFlagArg = (parsed: Args, arg: string): boolean => {
  if (arg === "--json") parsed.json = true;
  else if (arg === "--text") parsed.text = true;
  else if (arg === "--include-records") parsed.includeRecords = true;
  else if (arg === "--all-sessions") parsed.allSessions = true;
  else return false;
  return true;
};

const applyValueArg = (parsed: Args, arg: string, value: string) =>
  Effect.gen(function* () {
    if (arg === "--sessions-dir") parsed.sessionsDir = value;
    else if (arg === "--since") parsed.since = value;
    else if (arg === "--auto-since-path") parsed.autoSincePath = value;
    else if (arg === "--model") parsed.modelFilter = value;
    else if (arg === "--bucket") {
      if (value !== "day" && value !== "week") {
        return yield* new ReadToolStatsError({ message: "--bucket must be day or week" });
      }
      parsed.bucket = value;
    } else {
      const top = Number.parseInt(value, 10);
      if (!Number.isFinite(top) || top <= 0) {
        return yield* new ReadToolStatsError({ message: "--top must be a positive integer" });
      }
      parsed.top = top;
    }
  });

const parseArgs = (host: HostShape) =>
  Effect.gen(function* () {
    const args = process.argv.slice(2);
    const parsed = defaultArgs(host);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index] ?? "";
      if (arg === "--help" || arg === "-h") {
        yield* Console.log(HELP);
        return yield* Effect.sync(() => process.exit(0));
      }
      if (VALUE_ARGS.has(arg)) {
        yield* applyValueArg(parsed, arg, args[index + 1] ?? "");
        index += 1;
      } else if (!applyFlagArg(parsed, arg)) {
        return yield* new ReadToolStatsError({ message: `Unknown argument: ${arg}` });
      }
    }
    return parsed;
  });

const bucketKeys = (args: Args) =>
  Effect.gen(function* () {
    const zone = yield* reportZone;
    const inBucket = args.bucket === "day" ? zone.day : zone.week;
    return {
      bucketOf: (record: ReadRecord): string =>
        Number.isFinite(record.timestampMs) ? inBucket(record.timestampMs) : "[unknown]",
      hourOf: (record: ReadRecord): string =>
        Number.isFinite(record.timestampMs) ? zone.hour(record.timestampMs) : "[unknown]",
    };
  });

const printReport = (options: {
  readonly args: Args;
  readonly records: ReadonlyArray<ReadRecord>;
  readonly summary: ReturnType<typeof buildReadSummary>;
}) =>
  Effect.gen(function* () {
    const { args, records, summary } = options;
    if (args.json) {
      return yield* Console.log(
        yield* encodeIndentedJson(args.includeRecords ? { summary, records } : { summary }),
      );
    }
    if (args.text) return yield* Console.log(buildReadTextReport(summary));
    return yield* Console.log(buildReadHtmlReport(summary));
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const sessionsDir = host.resolve(args.sessionsDir);
  if (!(yield* host.exists(sessionsDir))) {
    return yield* new ReadToolStatsError({
      message: `Sessions directory not found: ${sessionsDir}`,
    });
  }
  const since = yield* resolveSince({
    allSessions: args.allSessions,
    autoSincePath: args.autoSincePath,
    host,
    since: args.since,
  });
  const { meta, records } = yield* scanReadCalls({ host, sessionsDir, since });
  const filter = args.modelFilter?.toLowerCase();
  const filtered =
    filter === undefined || filter === ""
      ? records
      : records.filter((record) => record.providerModel.toLowerCase().includes(filter));
  const summary = buildReadSummary({
    bucket: args.bucket,
    ...(yield* bucketKeys(args)),
    meta,
    modelFilter: args.modelFilter,
    records: filtered,
    top: args.top,
  });
  yield* printReport({ args, records: filtered, summary });
});

runScript(program);
