import { constants as osConstants } from "node:os";

import { Effect, FileSystem } from "effect";
import { dual } from "effect/Function";

import { type ChildProcess, spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";
import {
  getShellConfig,
  getShellEnv,
  killProcessTree,
  type ShellConfig,
  trackDetachedChildPid,
  untrackDetachedChildPid,
} from "../../utils/shell.ts";
import { fromPromise, platformRuntime, ToolFailure, unwrapForeign } from "../platform/index.ts";

type SpawnedShell = ChildProcess;

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal | undefined;
      timeout?: number | undefined;
      env?: NodeJS.ProcessEnv | undefined;
    },
  ) => Promise<{ exitCode: number | null }>;
}

export type ExecuteOptions = Parameters<BashOperations["exec"]>[2];

const validateTimeout = (timeout: number | undefined) => {
  if (timeout === undefined) return Effect.void;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return Effect.fail(
      new ToolFailure({ message: "Invalid timeout: must be a finite number of seconds" }),
    );
  }
  return timeout * 1000 > MAX_TIMEOUT_MS
    ? Effect.fail(
        new ToolFailure({ message: `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds` }),
      )
    : Effect.void;
};

const childPid = (pid: number | undefined): number | undefined =>
  pid === undefined || pid === 0 ? undefined : pid;

const spawnShell = (
  shellConfig: ShellConfig,
  command: string,
  cwd: string,
  env: ExecuteOptions["env"],
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const commandFromStdin = shellConfig.commandTransport === "stdin";
      const child = spawnProcess(
        shellConfig.shell,
        commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
        {
          cwd,
          detached: process.platform !== "win32",
          env: env ?? getShellEnv(),
          stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      if (commandFromStdin) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(command);
      }
      const pid = childPid(child.pid);
      if (pid !== undefined) trackDetachedChildPid(pid);
      return child;
    }),
    (child) =>
      Effect.sync(() => {
        const pid = childPid(child.pid);
        if (pid !== undefined) untrackDetachedChildPid(pid);
      }),
  );

const exitCodeOf = (exitCode: number | null, signalCode: NodeJS.Signals | null): number =>
  exitCode ?? (signalCode === null ? 1 : 128 + (osConstants.signals[signalCode] ?? 0));

const superviseChild = Effect.fn("superviseChild")(function* (
  child: SpawnedShell,
  { onData, signal, timeout }: ExecuteOptions,
) {
  let timedOut = false;
  const killChild = (): void => {
    const pid = childPid(child.pid);
    if (pid !== undefined) killProcessTree(pid);
  };
  if (timeout !== undefined) {
    yield* Effect.sleep(timeout * 1000).pipe(
      Effect.andThen(
        Effect.sync(() => {
          timedOut = true;
          killChild();
        }),
      ),
      Effect.forkScoped,
    );
  }
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  if (signal !== undefined) {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        if (signal.aborted) killChild();
        else signal.addEventListener("abort", killChild, { once: true });
      }),
      () => Effect.sync(() => signal.removeEventListener("abort", killChild)),
    );
  }
  const exitCode = yield* fromPromise(() => waitForChildProcess(child));
  if (signal?.aborted === true) return yield* new ToolFailure({ message: "aborted" });
  if (timedOut) return yield* new ToolFailure({ message: `timeout:${timeout}` });
  return { exitCode: exitCodeOf(exitCode, child.signalCode) };
});

const runShell = Effect.fn("runShell")(function* (
  shellName: string,
  resolveShellConfig: () => ShellConfig,
  command: string,
  cwd: string,
  options: ExecuteOptions,
) {
  yield* validateTimeout(options.timeout);
  if (options.signal?.aborted === true) return yield* new ToolFailure({ message: "aborted" });
  const shellConfig = yield* Effect.sync(resolveShellConfig);
  yield* FileSystem.FileSystem.use((fs) => fs.access(cwd)).pipe(
    Effect.mapError(
      () =>
        new ToolFailure({
          message: `Working directory does not exist: ${cwd}\nCannot execute ${shellName} commands.`,
        }),
    ),
  );
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawnShell(shellConfig, command, cwd, options.env);
      return yield* superviseChild(child, options);
    }),
  );
});

export const createLocalShellOperations: {
  (resolveShellConfig: () => ShellConfig): (shellName: string) => BashOperations;
  (shellName: string, resolveShellConfig: () => ShellConfig): BashOperations;
} = dual(2, (shellName: string, resolveShellConfig: () => ShellConfig): BashOperations => ({
  exec: (command, cwd, options) =>
    platformRuntime.runPromise(
      unwrapForeign(runShell(shellName, resolveShellConfig, command, cwd, options)),
    ),
}));

export function createLocalBashOperations(options?: {
  shellPath?: string | undefined;
}): BashOperations {
  return createLocalShellOperations("bash", () => getShellConfig(options?.shellPath));
}
