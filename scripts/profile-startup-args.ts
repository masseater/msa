import { Effect, Function } from "effect";

import cliOptions from "./cli-options.ts";
import type cliOptionsTypes from "./cli-options.types.ts";
import ProfileError from "./profile-error.ts";
import type profileStartupArgsTypes from "./profile-startup-args.types.ts";

const { flagOption, parseOptions, requiredOption } = cliOptions;

const HELP = `Usage:
  node scripts/profile-coding-agent-node.ts [options]

Profiles coding-agent startup with the runtime selected below:
- npm run profile:tui     -> builds apps/coding-agent and profiles TUI startup with Node
- npm run profile:rpc     -> builds apps/coding-agent and profiles RPC startup with Node
- bun run profile:tui     -> profiles TUI startup from src/cli.ts directly with Bun
- bun run profile:rpc     -> profiles RPC startup from src/cli.ts directly with Bun

Options:
  --mode <name>          tui or rpc (default: tui)
  --runs <n>             Number of measured runs (default: 1)
  --warmup <n>           Number of warmup runs before measurements (default: 0)
  --profile-dir <dir>    CPU profile output directory
                         Default: profiles-node for Node, profiles-bun for Bun
  --label <name>         Profile name prefix (default: <mode>-startup)
  --runtime <name>       node, bun, or auto (default: auto)
  --agent-dir <dir>      Use a specific MSA_CODING_AGENT_DIR for the benchmark run
  --isolated-agent-dir   Use a fresh temporary agent dir instead of the normal one
  --bundle               Build and profile the bundled Node entrypoint instead of dist/cli.js
  --no-offline           Do not force MSA_OFFLINE=1 / MSA_SKIP_VERSION_CHECK=1
  --skip-build           Reuse the selected build output without rebuilding first (Node only)
  --cpu-profile          Write CPU profiles for benchmark runs
  --help                 Show this help

Notes:
  - By default the benchmark uses your normal configured agent dir, so global models/auth/settings work.
  - TUI mode measures startup until the interactive UI reaches first usable state.
  - RPC mode measures startup until a real get_state request receives a response, then closes stdin to exit cleanly.
  - CPU profiles are kept in the selected profile directory for later analysis.
`;

const fail = (message: string) => new ProfileError({ message });

const parseIntegerFlag = (value: string, name: string) => {
  const parsed = Number.parseInt(value, 10);
  return !Number.isFinite(parsed) || parsed < 0
    ? Effect.fail(fail(`Invalid ${name}: ${value}`))
    : Effect.succeed(parsed);
};

const parseRuntime = (
  value: string,
): Effect.Effect<profileStartupArgsTypes.Runtime | "auto", ProfileError> =>
  value === "auto" || value === "node" || value === "bun"
    ? Effect.succeed(value)
    : Effect.fail(fail(`Invalid --runtime: ${value}`));

const parseMode = (value: string): Effect.Effect<profileStartupArgsTypes.Mode, ProfileError> =>
  value === "tui" || value === "rpc"
    ? Effect.succeed(value)
    : Effect.fail(fail(`Invalid --mode: ${value}`));

const defaultOptions = (): profileStartupArgsTypes.ProfileOptions => ({
  agentDir: undefined,
  build: true,
  bundle: false,
  cpuProfile: false,
  help: false,
  isolatedAgentDir: false,
  label: undefined,
  mode: "tui",
  offline: true,
  profileDir: undefined,
  runs: 1,
  runtime: "auto",
  warmup: 0,
});

const flag = (
  name: string,
  set: (options: profileStartupArgsTypes.ProfileOptions) => void,
): readonly [
  string,
  cliOptionsTypes.CliOption<profileStartupArgsTypes.ProfileOptions, ProfileError>,
] => [name, flagOption(set)];

const valueFlag = (
  name: string,
  apply: (
    options: profileStartupArgsTypes.ProfileOptions,
    value: string,
  ) => Effect.Effect<void, ProfileError>,
): readonly [
  string,
  cliOptionsTypes.CliOption<profileStartupArgsTypes.ProfileOptions, ProfileError>,
] => requiredOption({ apply, missing: (option) => fail(`Missing value for ${option}`), name });

const assign = <A>(parse: Effect.Effect<A, ProfileError>, set: (value: A) => void) =>
  Effect.map(parse, set);

const FLAG_OPTIONS = [
  flag("--help", (options) => {
    options.help = true;
  }),
  flag("-h", (options) => {
    options.help = true;
  }),
  flag("--no-offline", (options) => {
    options.offline = false;
  }),
  flag("--isolated-agent-dir", (options) => {
    options.isolatedAgentDir = true;
  }),
  flag("--bundle", (options) => {
    options.bundle = true;
  }),
  flag("--skip-build", (options) => {
    options.build = false;
  }),
  flag("--cpu-profile", (options) => {
    options.cpuProfile = true;
  }),
];

const valueOptions = (resolve: (path: string) => string) => [
  valueFlag("--mode", (options, value) =>
    assign(parseMode(value), (mode) => {
      options.mode = mode;
    }),
  ),
  valueFlag("--runs", (options, value) =>
    assign(parseIntegerFlag(value, "--runs"), (runs) => {
      options.runs = runs;
    }),
  ),
  valueFlag("--warmup", (options, value) =>
    assign(parseIntegerFlag(value, "--warmup"), (warmup) => {
      options.warmup = warmup;
    }),
  ),
  valueFlag("--profile-dir", (options, value) =>
    Effect.sync(() => {
      options.profileDir = resolve(value);
    }),
  ),
  valueFlag("--label", (options, value) =>
    Effect.sync(() => {
      options.label = value;
    }),
  ),
  valueFlag("--runtime", (options, value) =>
    assign(parseRuntime(value), (runtime) => {
      options.runtime = runtime;
    }),
  ),
  valueFlag("--agent-dir", (options, value) =>
    Effect.sync(() => {
      options.agentDir = resolve(value);
    }),
  ),
];

const profileOptions = (
  resolve: (path: string) => string,
): ReadonlyMap<
  string,
  cliOptionsTypes.CliOption<profileStartupArgsTypes.ProfileOptions, ProfileError>
> => new Map([...FLAG_OPTIONS, ...valueOptions(resolve)]);

const parseArgs: {
  (
    resolve: (path: string) => string,
  ): (
    argv: ReadonlyArray<string>,
  ) => Effect.Effect<profileStartupArgsTypes.ProfileOptions, ProfileError>;
  (
    argv: ReadonlyArray<string>,
    resolve: (path: string) => string,
  ): Effect.Effect<profileStartupArgsTypes.ProfileOptions, ProfileError>;
} = Function.dual(2, (argv: ReadonlyArray<string>, resolve: (path: string) => string) =>
  parseOptions({
    args: argv,
    options: profileOptions(resolve),
    parsed: defaultOptions(),
    unknown: (arg) => Effect.fail(fail(`Unknown option: ${arg}`)),
  }),
);

const profileStartupArgs = {
  HELP,
  ProfileError,
  fail,
  parseArgs,
};

export default profileStartupArgs;
