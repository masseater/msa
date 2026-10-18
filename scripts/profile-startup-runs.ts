import { Console, Effect, Ref, Stream } from "effect";

import type { HostShape } from "./host.ts";
import { fail } from "./profile-startup-args.ts";
import type { Mode, ProfileOptions, Runtime } from "./profile-startup-args.ts";
import { formatMs, nowMs, parseStartupTimings } from "./profile-startup-report.ts";
import type { RunResult } from "./profile-startup-report.ts";
import { getStateRequest, handleLine, rpcElapsed } from "./profile-startup-rpc.ts";
import type { LineContext, RpcState } from "./profile-startup-rpc.ts";

interface Paths {
  readonly bundledDistCli: string;
  readonly distCli: string;
  readonly packageDir: string;
  readonly repoRoot: string;
  readonly srcCli: string;
}

interface RunParams {
  readonly host: HostShape;
  readonly measuredIndex: number | undefined;
  readonly options: ProfileOptions & { readonly label: string };
  readonly paths: Paths;
  readonly profileDir: string;
  readonly runIndex: number;
  readonly runtime: Runtime;
}

const isWindows = process.platform === "win32";

const BUILD_COMMANDS = (bundle: boolean) => [
  {
    label: "Dependency build",
    args: [
      "run",
      "build",
      "--workspace",
      "libs/tui",
      "--workspace",
      "libs/telemetry",
      "--workspace",
      "libs/ai",
      "--workspace",
      "libs/agent",
    ],
  },
  {
    label: "Coding-agent build",
    args: ["run", bundle ? "build" : "build:unbundled", "--workspace", "apps/coding-agent"],
  },
];

const withoutTrailingNewline = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text);

const runBuild = (options: {
  readonly bundle: boolean;
  readonly host: HostShape;
  readonly repoRoot: string;
}) =>
  Effect.gen(function* () {
    const { bundle, host, repoRoot } = options;
    yield* Console.log(
      `Building dependencies and the ${bundle ? "bundled" : "unbundled"} coding-agent Node entrypoint...`,
    );
    const startedAt = yield* nowMs;
    yield* Effect.forEach(BUILD_COMMANDS(bundle), (command) =>
      Effect.gen(function* () {
        const result = yield* host.run({
          args: command.args,
          command: "npm",
          cwd: repoRoot,
          shell: isWindows,
          stdin: "ignore",
        });
        if (result.exitCode === 0) return;
        if (result.stdout.trim() !== "") yield* Console.log(withoutTrailingNewline(result.stdout));
        if (result.stderr.trim() !== "") {
          yield* Console.error(withoutTrailingNewline(result.stderr));
        }
        return yield* fail(`${command.label} failed with exit code ${result.exitCode}`);
      }),
    );
    yield* Console.log(`Build completed in ${formatMs((yield* nowMs) - startedAt)}`);
  });

const benchmarkArgsOf = (mode: Mode): ReadonlyArray<string> =>
  mode === "rpc" ? ["--no-session", "--mode", "rpc"] : ["--no-session"];

const profileArgsOf = (params: RunParams, profileName: string): ReadonlyArray<string> =>
  params.options.cpuProfile
    ? ["--cpu-prof", `--cpu-prof-dir=${params.profileDir}`, `--cpu-prof-name=${profileName}`]
    : [];

const runtimeCommand = (params: RunParams, mode: Mode, profileName: string) => {
  const benchmarkArgs = benchmarkArgsOf(mode);
  const profileArgs = profileArgsOf(params, profileName);
  if (params.runtime === "bun") {
    return { command: "bun", args: [...profileArgs, params.paths.srcCli, ...benchmarkArgs] };
  }
  const entry = params.options.bundle ? params.paths.bundledDistCli : params.paths.distCli;
  return { command: process.execPath, args: [...profileArgs, entry, ...benchmarkArgs] };
};

const OFFLINE_ENV: Readonly<Record<string, string>> = {
  MSA_OFFLINE: "1",
  MSA_SKIP_VERSION_CHECK: "1",
};

const agentDirEnv = (agentDir: string | undefined): Readonly<Record<string, string>> =>
  agentDir === undefined ? {} : { MSA_CODING_AGENT_DIR: agentDir };

const benchmarkEnv = (
  params: RunParams,
  isolatedAgentDir: string | undefined,
): Readonly<Record<string, string>> => {
  const { options } = params;
  return {
    MSA_TIMING: "1",
    ...agentDirEnv(options.agentDir ?? isolatedAgentDir),
    ...(options.mode === "tui" ? { MSA_STARTUP_BENCHMARK: "1" } : {}),
    ...(options.offline ? OFFLINE_ENV : {}),
  };
};

const spawnOptions = (options: {
  readonly isolatedAgentDir: string | undefined;
  readonly mode: Mode;
  readonly params: RunParams;
  readonly profileName: string;
}) => {
  const { params } = options;
  return {
    ...runtimeCommand(params, options.mode, options.profileName),
    cwd: params.paths.packageDir,
    env: benchmarkEnv(params, options.isolatedAgentDir),
    shell: isWindows && params.runtime === "bun",
  };
};

const withAgentDir = <A, E, R>(
  params: RunParams,
  use: (isolatedAgentDir: string | undefined) => Effect.Effect<A, E, R>,
) => {
  if (!params.options.isolatedAgentDir) return use(undefined);
  const { host } = params;
  return Effect.acquireUseRelease(
    host.makeTempDirectory("msa-startup-benchmark-"),
    (tempRoot) =>
      Effect.gen(function* () {
        const agentDir = host.join(tempRoot, "agent");
        yield* host.makeDirectory(agentDir);
        return yield* use(agentDir);
      }),
    (tempRoot) => host.remove(tempRoot),
  );
};

const finishRun = (
  params: RunParams,
  profileName: string,
  result: { readonly elapsedMs: number; readonly stderr: string },
) =>
  Effect.gen(function* () {
    const profilePath = params.options.cpuProfile
      ? params.host.join(params.profileDir, profileName)
      : undefined;
    if (profilePath !== undefined && !(yield* params.host.exists(profilePath))) {
      return yield* fail(`CPU profile was not written: ${profilePath}`);
    }
    return {
      elapsedMs: result.elapsedMs,
      profilePath,
      timings: parseStartupTimings(result.stderr),
    } satisfies RunResult;
  });

const exitFailure = (stderr: string, exitCode: number) =>
  fail(stderr.trim() === "" ? `Benchmark child exited with code ${exitCode}` : stderr.trim());

const profileNameOf = (params: RunParams) =>
  `${params.options.label}-${String(params.runIndex + 1).padStart(3, "0")}.cpuprofile`;

const runTui = (params: RunParams) =>
  withAgentDir(params, (isolatedAgentDir) =>
    Effect.scoped(
      Effect.gen(function* () {
        const profileName = profileNameOf(params);
        const child = yield* params.host.spawn({
          ...spawnOptions({ isolatedAgentDir, mode: "tui", params, profileName }),
          stderr: "pipe",
          stdin: "inherit",
          stdout: "inherit",
        });
        const startedAt = yield* nowMs;
        const [stderr, exitCode] = yield* Effect.all([child.stderrText, child.exitCode], {
          concurrency: "unbounded",
        });
        const elapsedMs = (yield* nowMs) - startedAt;
        if (exitCode !== 0) return yield* exitFailure(stderr, exitCode);
        return yield* finishRun(params, profileName, { elapsedMs, stderr });
      }),
    ),
  );

const runRpc = (params: RunParams) =>
  withAgentDir(params, (isolatedAgentDir) =>
    Effect.scoped(
      Effect.gen(function* () {
        const profileName = profileNameOf(params);
        const child = yield* params.host.spawn({
          ...spawnOptions({ isolatedAgentDir, mode: "rpc", params, profileName }),
          stderr: "pipe",
          stdin: "pipe",
          stdout: "pipe",
        });
        const requestId = `startup-benchmark-${params.runIndex + 1}`;
        const state = yield* Ref.make<RpcState>({
          readyElapsedMs: undefined,
          responseError: undefined,
        });
        const startedAt = yield* nowMs;
        const context: LineContext = { onReady: child.endInput, requestId, startedAt, state };
        const consumeStdout = Stream.runForEach(child.stdoutLines, handleLine(context));
        yield* child.write(yield* getStateRequest(requestId));
        const [, stderr, exitCode] = yield* Effect.all(
          [consumeStdout, child.stderrText, child.exitCode],
          { concurrency: "unbounded" },
        );
        const elapsedMs = yield* rpcElapsed({ state: yield* Ref.get(state), stderr });
        if (exitCode !== 0) return yield* exitFailure(stderr, exitCode);
        return yield* finishRun(params, profileName, { elapsedMs, stderr });
      }),
    ),
  );

export type { Paths, RunParams };
export { runBuild, runRpc, runTui };
