import { homedir } from "node:os";

import { Effect, Schema } from "effect";

import cliOptions from "./cli-options.ts";
import type cliOptionsTypes from "./cli-options.types.ts";
import type hostTypes from "./host.types.ts";
import type readToolArgsTypes from "./read-tool-args.types.ts";
import scanOptionsModule from "./scan-options.ts";

const { flagOption, parseCommandLine, valueOption } = cliOptions;
const { scanOptions } = scanOptionsModule;

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

class ReadToolStatsError extends Schema.TaggedError<
  ReadToolStatsError,
  { readonly brand: unique symbol }
>()("ReadToolStatsError", { message: Schema.String }) {}

const defaultArgs = (host: hostTypes.HostShape): readToolArgsTypes.Args => ({
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

const fail = (message: string) => ReadToolStatsError.make({ message });

const parseBucket = (
  value: string | undefined,
): Effect.Effect<readToolArgsTypes.Args["bucket"], ReadToolStatsError> =>
  value === "day" || value === "week"
    ? Effect.succeed(value)
    : Effect.fail(fail("--bucket must be day or week"));

const OPTIONS: ReadonlyArray<
  readonly [string, cliOptionsTypes.CliOption<readToolArgsTypes.Args, ReadToolStatsError>]
> = [
  ...scanOptions<readToolArgsTypes.Args, ReadToolStatsError>(fail),
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
];

const parseArgs = (host: hostTypes.HostShape) =>
  parseCommandLine({ defaults: defaultArgs(host), fail, help: HELP, options: OPTIONS });

const readToolArgs = {
  ReadToolStatsError,
  parseArgs,
};

export default readToolArgs;
