import { Config, Console, Effect, Option } from "effect";

import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { HELP, parseArgs } from "./profile-startup-args.ts";
import type { ProfileOptions, Runtime } from "./profile-startup-args.ts";
import { buildReport } from "./profile-startup-report.ts";
import type { RunResult } from "./profile-startup-report.ts";
import { fail, runBuild, runRpc, runTui } from "./profile-startup-runs.ts";
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

const validate = (options: ProfileOptions, runtime: Runtime) =>
  Effect.gen(function* () {
    if (options.agentDir !== undefined && options.isolatedAgentDir) {
      return yield* fail("--agent-dir and --isolated-agent-dir cannot be combined");
    }
    if (options.mode === "tui" && (process.stdin.isTTY !== true || process.stdout.isTTY !== true)) {
      return yield* fail("TUI benchmark must be run from an interactive terminal.");
    }
    if (options.bundle && runtime !== "node") {
      return yield* fail("--bundle only supports the Node runtime");
    }
  });

const checkEntry = (host: HostShape, paths: Paths, options: ProfileOptions, runtime: Runtime) =>
  Effect.gen(function* () {
    const facadeCheck =
      runtime === "node" &&
      !options.bundle &&
      !options.build &&
      (yield* host.exists(paths.distCli)) &&
      (yield* host.readText(paths.distCli)).includes('import "./bundle/cli.js";');
    if (facadeCheck) {
      return yield* fail(
        "dist/cli.js is a bundled facade; rerun without --skip-build for an unbundled profile",
      );
    }
    const entryPath =
      runtime === "bun" ? paths.srcCli : options.bundle ? paths.bundledDistCli : paths.distCli;
    if (!(yield* host.exists(entryPath))) {
      return yield* fail(`CLI entrypoint not found: ${entryPath}`);
    }
  });

const prepare = (host: HostShape, paths: Paths, options: ProfileOptions, runtime: Runtime) =>
  Effect.gen(function* () {
    if (runtime === "node" && options.build)
      yield* runBuild({ bundle: options.bundle, host, repoRoot: paths.repoRoot });
    if (runtime === "bun") {
      const entry =
        options.mode === "rpc"
          ? "apps/coding-agent/src/cli.ts --mode rpc"
          : "apps/coding-agent/src/cli.ts";
      yield* Console.log(`Using Bun runtime with ${entry}`);
    }
    yield* checkEntry(host, paths, options, runtime);
  });

const runAll = (base: Omit<RunParams, "measuredIndex" | "runIndex">) =>
  Effect.gen(function* () {
    const { runs, warmup } = base.options;
    const indices = Array.from({ length: warmup + runs }, (_, index) => index);
    const results = yield* Effect.forEach(indices, (runIndex) =>
      Effect.gen(function* () {
        const measuredIndex = runIndex >= warmup ? runIndex - warmup + 1 : undefined;
        const params = { ...base, measuredIndex, runIndex };
        const result = yield* base.options.mode === "rpc" ? runRpc(params) : runTui(params);
        const label =
          measuredIndex === undefined ? `warmup ${runIndex + 1}` : `run ${measuredIndex}`;
        yield* Console.log(`[${label}] elapsed=${result.elapsedMs.toFixed(1)}ms`);
        return measuredIndex === undefined ? undefined : result;
      }),
    );
    return results.filter((result): result is RunResult => result !== undefined);
  });

const main = Effect.gen(function* () {
  const host = yield* Host;
  const paths = makePaths(host);
  const options = yield* parseArgs(process.argv.slice(2), (path) => host.resolve(path));
  if (options.help) return yield* Console.log(HELP);
  const runtime = yield* resolveRuntime(options.runtime);
  yield* validate(options, runtime);
  const label = options.label ?? `${options.mode}-startup`;
  const profileDir =
    options.profileDir ??
    host.join(paths.repoRoot, runtime === "bun" ? "profiles-bun" : "profiles-node");
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
      runtimeLabel: `${runtime}${options.bundle ? " (bundle)" : ""}`,
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
