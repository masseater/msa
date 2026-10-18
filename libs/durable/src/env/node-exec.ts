import type { Context } from "@msa/chord";
import { Effect, FileSystem } from "effect";

import { nodeRuntime } from "../node-runtime.ts";
import { ExecutionError } from "./execution-error.ts";
import type { FileError } from "./file-error.ts";
import { resolvePath } from "./node-paths.ts";
import { ShellRun } from "./node-shell-run.ts";
import { resolveTimeoutMs, shellConfig } from "./node-shell.ts";
import { err, ok, type Result, toError } from "./result.ts";
import type { ShellExecOptions, ShellExecResult } from "./types.ts";

export interface ExecTarget {
  readonly cwd: string;
  readonly shellPath: string | undefined;
  readonly shellEnv: NodeJS.ProcessEnv | undefined;
  readonly activeChildPids: Set<number>;
  readonly createTempFile: Effect.Effect<Result<string, FileError>>;
}

type Invocation = {
  readonly program: string;
  readonly args: readonly string[];
  readonly stdinCommand: string | undefined;
};

const invocationOf = Effect.fnUntraced(function* (
  command: string | readonly string[],
  shellPath: string | undefined,
) {
  if (typeof command === "string") {
    const config = yield* Effect.promise(() => shellConfig(shellPath));
    if (!config.ok) return err<Invocation, ExecutionError>(config.error);
    const fromStdin = config.value.commandTransport === "stdin";
    return ok<Invocation, ExecutionError>({
      program: config.value.shell,
      args: fromStdin ? config.value.args : [...config.value.args, command],
      stdinCommand: fromStdin ? command : undefined,
    });
  }
  const [first, ...rest] = command;
  if (first === undefined) {
    return err<Invocation, ExecutionError>(
      new ExecutionError("spawn_error", "Empty argv: no program to run"),
    );
  }
  return ok<Invocation, ExecutionError>({ program: first, args: rest, stdinCommand: undefined });
});

const missingWorkingDirectory = (cwd: string) =>
  FileSystem.FileSystem.use((fs) => fs.access(cwd)).pipe(
    Effect.as(undefined),
    Effect.catch((error) =>
      Effect.succeed(
        new ExecutionError(
          "spawn_error",
          `Working directory does not exist: ${cwd}\nCannot execute bash commands.`,
          toError(error.cause ?? error),
        ),
      ),
    ),
  );

const shellEnvironment = (
  target: ExecTarget,
  options: ShellExecOptions | undefined,
): NodeJS.ProcessEnv =>
  options?.inheritEnv === false
    ? { ...options.env }
    : { ...process.env, ...target.shellEnv, ...options?.env };

const executeIn = Effect.fnUntraced(function* (
  target: ExecTarget,
  command: string | readonly string[],
  options: ShellExecOptions | undefined,
  context: Context,
) {
  if (context.abortSignal?.aborted === true) {
    return err<ShellExecResult, ExecutionError>(new ExecutionError("aborted", "aborted"));
  }
  const timeoutMs = resolveTimeoutMs(options?.timeout);
  if (!timeoutMs.ok) return err<ShellExecResult, ExecutionError>(timeoutMs.error);
  const cwd =
    options?.cwd === undefined || options.cwd === ""
      ? target.cwd
      : resolvePath(target.cwd, options.cwd);
  const invocation = yield* invocationOf(command, target.shellPath);
  if (!invocation.ok) return err<ShellExecResult, ExecutionError>(invocation.error);
  const missing = yield* missingWorkingDirectory(cwd);
  if (missing !== undefined) return err<ShellExecResult, ExecutionError>(missing);
  return yield* new ShellRun({
    ...invocation.value,
    cwd,
    env: shellEnvironment(target, options),
    timeoutMs: timeoutMs.value,
    timeout: options?.timeout,
    context,
    onOutput: options?.onOutput,
    spill: options?.spill,
    activeChildPids: target.activeChildPids,
    createTempFile: target.createTempFile,
  }).run();
});

export interface ExecRequest {
  readonly target: ExecTarget;
  readonly command: string | readonly string[];
  readonly options: ShellExecOptions | undefined;
  readonly context: Context;
}

export const execute = ({
  target,
  command,
  options,
  context,
}: ExecRequest): Promise<Result<ShellExecResult, ExecutionError>> =>
  nodeRuntime.runPromise(executeIn(target, command, options, context));
