import { Clock, Console, Effect, Ref, Result, Schema, Stream } from "effect";

import type { HostShape } from "./host.ts";
import { ProfileError } from "./profile-startup-args.ts";
import type { Mode, ProfileOptions, Runtime } from "./profile-startup-args.ts";
import { formatMs, parseStartupTimings } from "./profile-startup-report.ts";
import type { RunResult } from "./profile-startup-report.ts";

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

const RpcResponse = Schema.fromJsonString(Schema.Unknown);
const decodeRpcResponse = Schema.decodeUnknownEffect(RpcResponse);
const encodeRequest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, type: Schema.String })),
);

const fail = (message: string) => new ProfileError({ message });

const nowMs = Effect.map(Clock.currentTimeNanos, (nanos) => Number(nanos) / 1_000_000);

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

const runtimeCommand = (params: RunParams, mode: Mode, profileName: string) => {
  const benchmarkArgs = mode === "rpc" ? ["--no-session", "--mode", "rpc"] : ["--no-session"];
  const profileArgs = params.options.cpuProfile
    ? ["--cpu-prof", `--cpu-prof-dir=${params.profileDir}`, `--cpu-prof-name=${profileName}`]
    : [];
  if (params.runtime === "bun") {
    return { command: "bun", args: [...profileArgs, params.paths.srcCli, ...benchmarkArgs] };
  }
  const entry = params.options.bundle ? params.paths.bundledDistCli : params.paths.distCli;
  return { command: process.execPath, args: [...profileArgs, entry, ...benchmarkArgs] };
};

const benchmarkEnv = (params: RunParams, isolatedAgentDir: string | undefined) => {
  const { options } = params;
  const env: Record<string, string> = { MSA_TIMING: "1" };
  const agentDir = options.agentDir ?? isolatedAgentDir;
  if (agentDir !== undefined) env.MSA_CODING_AGENT_DIR = agentDir;
  if (options.mode === "tui") env.MSA_STARTUP_BENCHMARK = "1";
  if (options.offline) {
    env.MSA_OFFLINE = "1";
    env.MSA_SKIP_VERSION_CHECK = "1";
  }
  return env;
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
        const command = runtimeCommand(params, "tui", profileName);
        const child = yield* params.host.spawn({
          ...command,
          cwd: params.paths.packageDir,
          env: benchmarkEnv(params, isolatedAgentDir),
          shell: isWindows && params.runtime === "bun",
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

interface RpcState {
  readonly readyElapsedMs: number | undefined;
  readonly responseError: string | undefined;
}

const GetStateResponse = Schema.Struct({
  command: Schema.Literal("get_state"),
  error: Schema.optional(Schema.Unknown),
  id: Schema.String,
  success: Schema.optional(Schema.Unknown),
  type: Schema.Literal("response"),
});
const isGetStateResponse = Schema.is(GetStateResponse);

const handleLine = (options: {
  readonly line: string;
  readonly onReady: Effect.Effect<void>;
  readonly requestId: string;
  readonly startedAt: number;
  readonly state: Ref.Ref<RpcState>;
}) =>
  Effect.gen(function* () {
    const { line, requestId, state } = options;
    if (line.trim() === "") return;
    const decoded = yield* decodeRpcResponse(line).pipe(Effect.result);
    if (Result.isFailure(decoded)) {
      const responseError = decoded.failure.message;
      yield* Ref.update(state, (current) => ({ ...current, responseError }));
      return;
    }
    const parsed = decoded.success;
    if (!isGetStateResponse(parsed) || parsed.id !== requestId) return;
    if (parsed.success !== true) {
      const responseError = typeof parsed.error === "string" ? parsed.error : "get_state failed";
      yield* Ref.update(state, (current) => ({ ...current, responseError }));
      return;
    }
    if ((yield* Ref.get(state)).readyElapsedMs !== undefined) return;
    const readyElapsedMs = (yield* nowMs) - options.startedAt;
    yield* Ref.update(state, (current) => ({ ...current, readyElapsedMs }));
    yield* options.onReady;
  });

const runRpc = (params: RunParams) =>
  withAgentDir(params, (isolatedAgentDir) =>
    Effect.scoped(
      Effect.gen(function* () {
        const profileName = profileNameOf(params);
        const command = runtimeCommand(params, "rpc", profileName);
        const child = yield* params.host.spawn({
          ...command,
          cwd: params.paths.packageDir,
          env: benchmarkEnv(params, isolatedAgentDir),
          shell: isWindows && params.runtime === "bun",
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
        const consumeStdout = Stream.runForEach(child.stdoutLines, (line) =>
          handleLine({ line, onReady: child.endInput, requestId, startedAt, state }),
        );
        yield* child.write(`${yield* encodeRequest({ id: requestId, type: "get_state" })}\n`);
        const [, stderr, exitCode] = yield* Effect.all(
          [consumeStdout, child.stderrText, child.exitCode],
          { concurrency: "unbounded" },
        );
        const { readyElapsedMs, responseError } = yield* Ref.get(state);
        if (responseError !== undefined) return yield* fail(responseError);
        if (readyElapsedMs === undefined) {
          return yield* fail(
            stderr.trim() === ""
              ? "RPC benchmark did not receive get_state response"
              : stderr.trim(),
          );
        }
        if (exitCode !== 0) return yield* exitFailure(stderr, exitCode);
        return yield* finishRun(params, profileName, { elapsedMs: readyElapsedMs, stderr });
      }),
    ),
  );

export type { Paths, RunParams };
export { fail, runBuild, runRpc, runTui };
