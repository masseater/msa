import { homedir } from "node:os";

import { Data, Effect } from "effect";

import { flagOption, helpOptions, parseOptions, valueOption } from "./cli-options.ts";
import type { CliOption } from "./cli-options.ts";
import type { HostShape } from "./host.ts";
import { scanOptions } from "./scan-options.ts";

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

const fail = (message: string) => new ReadToolStatsError({ message });

const parseBucket = (
  value: string | undefined,
): Effect.Effect<Args["bucket"], ReadToolStatsError> =>
  value === "day" || value === "week"
    ? Effect.succeed(value)
    : Effect.fail(fail("--bucket must be day or week"));

const OPTIONS = new Map<string, CliOption<Args, ReadToolStatsError>>([
  ...scanOptions<Args, ReadToolStatsError>(fail),
  [
    "--bucket",
    valueOption((parsed, value) =>
      Effect.map(parseBucket(value), (bucket) => {
        parsed.bucket = bucket;
      }),
    ),
  ],
  [
    "--text",
    flagOption((parsed) => {
      parsed.text = true;
    }),
  ],
  ...helpOptions(HELP),
]);

const parseArgs = (host: HostShape) =>
  parseOptions({
    args: process.argv.slice(2),
    options: OPTIONS,
    parsed: defaultArgs(host),
    unknown: (arg) => Effect.fail(fail(`Unknown argument: ${arg}`)),
  });

export type { Args };
export { parseArgs, ReadToolStatsError };
