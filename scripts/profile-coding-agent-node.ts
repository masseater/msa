import { Config, Console, Effect, Option } from "effect";

import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { fail, HELP, parseArgs } from "./profile-startup-args.ts";
import type { ProfileOptions, Runtime } from "./profile-startup-args.ts";
import { buildReport } from "./profile-startup-report.ts";
import type { RunResult } from "./profile-startup-report.ts";
import { runBuild, runRpc, runTui } from "./profile-startup-runs.ts";
import type { Paths, RunParams } from "./profile-startup-runs.ts";

const makePaths = (host: HostShape): Paths => {
  const repoRoot = host.resolve(import.meta.dirname, "..");
  const packageDir = host.join(repoRoot, "apps", "coding-agent");
  return {
    bundledDistCli: host.join(packageDir, "dist", "bundle", "cli.js"),
    distCli: host.join(packageDir, "dist", "cli.js"),
    packageDir,
    repoRoot,
    srcCli: host.join(packageDir, "src", "cli.ts"),
  };
};

const resolveRuntime = (requested: ProfileOptions["runtime"]) =>
  Effect.gen(function* () {
    if (requested !== "auto") return requested;
    const userAgent = yield* Config.option(Config.String("npm_config_user_agent"));
    return Option.getOrElse(userAgent, () => "").startsWith("bun/") ? "bun" : "node";
  });

const displayPath = (host: HostShape, repoRoot: string) => (path: string) => {
  const relativePath = host.relative(repoRoot, path);
  return relativePath !== "" && !relativePath.startsWith("..")
    ? relativePath.replaceAll("\\", "/")
    : path;
};

const isInteractiveTerminal = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

const VALIDATIONS: ReadonlyArray<{
  readonly message: string;
  readonly violated: (options: ProfileOptions, runtime: Runtime) => boolean;
}> = [
  {
    message: "--agent-dir and --isolated-agent-dir cannot be combined",
    violated: (options) => options.agentDir !== undefined && options.isolatedAgentDir,
  },
  {
    message: "TUI benchmark must be run from an interactive terminal.",
    violated: (options) => options.mode === "tui" && !isInteractiveTerminal(),
  },
  {
    message: "--bundle only supports the Node runtime",
    violated: (options, runtime) => options.bundle && runtime !== "node",
  },
];

const validate = (options: ProfileOptions, runtime: Runtime) => {
  const violation = VALIDATIONS.find((validation) => validation.violated(options, runtime));
  return violation === undefined ? Effect.void : Effect.fail(fail(violation.message));
};

const usesUnbundledDist = (options: ProfileOptions, runtime: Runtime): boolean =>
  runtime === "node" && !options.bundle && !options.build;

const isBundledFacade = (host: HostShape, distCli: string) =>
  Effect.gen(function* () {
    if (!(yield* host.exists(distCli))) return false;
    return (yield* host.readText(distCli)).includes('import "./bundle/cli.js";');
  });

const nodeEntryPath = (paths: Paths, options: ProfileOptions): string =>
  options.bundle ? paths.bundledDistCli : paths.distCli;

const entryPathOf = (paths: Paths, options: ProfileOptions, runtime: Runtime): string =>
  runtime === "bun" ? paths.srcCli : nodeEntryPath(paths, options);

const checkEntry = (host: HostShape, paths: Paths, options: ProfileOptions, runtime: Runtime) =>
  Effect.gen(function* () {
    if (usesUnbundledDist(options, runtime) && (yield* isBundledFacade(host, paths.distCli))) {
      return yield* fail(
        "dist/cli.js is a bundled facade; rerun without --skip-build for an unbundled profile",
      );
    }
    const entryPath = entryPathOf(paths, options, runtime);
    if (!(yield* host.exists(entryPath))) {
      return yield* fail(`CLI entrypoint not found: ${entryPath}`);
    }
  });

const bunEntry = (mode: ProfileOptions["mode"]): string =>
  mode === "rpc" ? "apps/coding-agent/src/cli.ts --mode rpc" : "apps/coding-agent/src/cli.ts";

const prepare = (host: HostShape, paths: Paths, options: ProfileOptions, runtime: Runtime) =>
  Effect.gen(function* () {
    if (runtime === "node" && options.build)
      yield* runBuild({ bundle: options.bundle, host, repoRoot: paths.repoRoot });
    if (runtime === "bun") yield* Console.log(`Using Bun runtime with ${bunEntry(options.mode)}`);
    yield* checkEntry(host, paths, options, runtime);
  });

const measuredIndexOf = (runIndex: number, warmup: number): number | undefined =>
  runIndex >= warmup ? runIndex - warmup + 1 : undefined;

const runLabel = (runIndex: number, measuredIndex: number | undefined): string =>
  measuredIndex === undefined ? `warmup ${runIndex + 1}` : `run ${measuredIndex}`;

const runAll = (base: Omit<RunParams, "measuredIndex" | "runIndex">) =>
  Effect.gen(function* () {
    const { runs, warmup } = base.options;
    const indices = Array.from({ length: warmup + runs }, (_, index) => index);
    const results = yield* Effect.forEach(indices, (runIndex) =>
      Effect.gen(function* () {
        const measuredIndex = measuredIndexOf(runIndex, warmup);
        const params = { ...base, measuredIndex, runIndex };
        const result = yield* base.options.mode === "rpc" ? runRpc(params) : runTui(params);
        yield* Console.log(
          `[${runLabel(runIndex, measuredIndex)}] elapsed=${result.elapsedMs.toFixed(1)}ms`,
        );
        return measuredIndex === undefined ? undefined : result;
      }),
    );
    return results.filter((result): result is RunResult => result !== undefined);
  });

const profileDirOf = (options: {
  readonly host: HostShape;
  readonly paths: Paths;
  readonly profileDir: string | undefined;
  readonly runtime: Runtime;
}): string =>
  options.profileDir ??
  options.host.join(
    options.paths.repoRoot,
    options.runtime === "bun" ? "profiles-bun" : "profiles-node",
  );

const runtimeLabel = (runtime: Runtime, bundle: boolean): string =>
  `${runtime}${bundle ? " (bundle)" : ""}`;

const main = Effect.gen(function* () {
  const host = yield* Host;
  const paths = makePaths(host);
  const options = yield* parseArgs(process.argv.slice(2), (path) => host.resolve(path));
  if (options.help) return yield* Console.log(HELP);
  const runtime = yield* resolveRuntime(options.runtime);
  yield* validate(options, runtime);
  const label = options.label ?? `${options.mode}-startup`;
  const profileDir = profileDirOf({ host, paths, profileDir: options.profileDir, runtime });
  yield* prepare(host, paths, options, runtime);
  yield* host.makeDirectory(profileDir);
  const measured = yield* runAll({
    host,
    options: { ...options, label },
    paths,
    profileDir,
    runtime,
  });
  const report = buildReport(
    {
      cpuProfile: options.cpuProfile,
      displayPath: displayPath(host, paths.repoRoot),
      mode: options.mode,
      profileDir,
      runtimeLabel: runtimeLabel(runtime, options.bundle),
    },
    measured,
  );
  yield* Effect.forEach(report, (line) => Console.log(line));
}).pipe(
  Effect.catchTag("ProfileError", (error) =>
    Effect.gen(function* () {
      yield* Console.error(error.message);
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }),
  ),
);

runScript(main);
