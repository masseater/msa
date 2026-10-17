import { Data, Effect, Function } from "effect";

type Mode = "rpc" | "tui";
type Runtime = "bun" | "node";

interface ProfileOptions {
  agentDir: string | undefined;
  build: boolean;
  bundle: boolean;
  cpuProfile: boolean;
  help: boolean;
  isolatedAgentDir: boolean;
  label: string | undefined;
  mode: Mode;
  offline: boolean;
  profileDir: string | undefined;
  runs: number;
  runtime: Runtime | "auto";
  warmup: number;
}

class ProfileError extends Data.TaggedError("ProfileError")<{ readonly message: string }> {}

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

const VALUE_FLAGS = new Set([
  "--agent-dir",
  "--label",
  "--mode",
  "--profile-dir",
  "--runs",
  "--runtime",
  "--warmup",
]);

const fail = (message: string) => new ProfileError({ message });

const parseIntegerFlag = (value: string, name: string) => {
  const parsed = Number.parseInt(value, 10);
  return !Number.isFinite(parsed) || parsed < 0
    ? Effect.fail(fail(`Invalid ${name}: ${value}`))
    : Effect.succeed(parsed);
};

const parseRuntime = (value: string): Effect.Effect<Runtime | "auto", ProfileError> =>
  value === "auto" || value === "node" || value === "bun"
    ? Effect.succeed(value)
    : Effect.fail(fail(`Invalid --runtime: ${value}`));

const parseMode = (value: string): Effect.Effect<Mode, ProfileError> =>
  value === "tui" || value === "rpc"
    ? Effect.succeed(value)
    : Effect.fail(fail(`Invalid --mode: ${value}`));

const defaultOptions = (): ProfileOptions => ({
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

const applyFlag = (options: ProfileOptions, arg: string): boolean => {
  if (arg === "--help" || arg === "-h") options.help = true;
  else if (arg === "--no-offline") options.offline = false;
  else if (arg === "--isolated-agent-dir") options.isolatedAgentDir = true;
  else if (arg === "--bundle") options.bundle = true;
  else if (arg === "--skip-build") options.build = false;
  else if (arg === "--cpu-profile") options.cpuProfile = true;
  else return false;
  return true;
};

const applyValue = (
  options: ProfileOptions,
  arg: string,
  value: string,
  resolve: (path: string) => string,
) =>
  Effect.gen(function* () {
    if (arg === "--mode") options.mode = yield* parseMode(value);
    else if (arg === "--runs") options.runs = yield* parseIntegerFlag(value, "--runs");
    else if (arg === "--warmup") options.warmup = yield* parseIntegerFlag(value, "--warmup");
    else if (arg === "--profile-dir") options.profileDir = resolve(value);
    else if (arg === "--label") options.label = value;
    else if (arg === "--runtime") options.runtime = yield* parseRuntime(value);
    else options.agentDir = resolve(value);
  });

type Resolve = (path: string) => string;

const parseArgs: {
  (resolve: Resolve): (argv: ReadonlyArray<string>) => Effect.Effect<ProfileOptions, ProfileError>;
  (argv: ReadonlyArray<string>, resolve: Resolve): Effect.Effect<ProfileOptions, ProfileError>;
} = Function.dual(2, (argv: ReadonlyArray<string>, resolve: Resolve) =>
  Effect.gen(function* () {
    const options = defaultOptions();
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index] ?? "";
      if (applyFlag(options, arg)) continue;
      if (!VALUE_FLAGS.has(arg)) return yield* fail(`Unknown option: ${arg}`);
      const value = argv[index + 1];
      if (value === undefined) return yield* fail(`Missing value for ${arg}`);
      yield* applyValue(options, arg, value, resolve);
      index += 1;
    }
    return options;
  }),
);

export type { Mode, ProfileOptions, Runtime };
export { HELP, ProfileError, parseArgs };
