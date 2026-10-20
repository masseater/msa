import * as NodeServices from "@effect/platform-node/NodeServices";
import type chordTypes from "@msa/chord/index.types";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import ExecutionError from "../execution-error.ts";
import resultModule from "../result.ts";
import type typesModule from "../types.ts";
import type nodeExecTypes from "./node-exec.types.ts";
import nodePaths from "./node-paths.ts";
import ShellRun from "./node-shell-run.ts";
import nodeShell from "./node-shell.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { resolveTimeoutMs, shellConfig } = nodeShell;
const { err, ok, toError } = resultModule;

const { resolvePath } = nodePaths;

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
    if (!config.ok) return err<Invocation, nodeExecTypes.ExecutionError>(config.error);
    const fromStdin = config.value.commandTransport === "stdin";
    return ok<Invocation, nodeExecTypes.ExecutionError>({
      args: fromStdin ? config.value.args : [...config.value.args, command],
      program: config.value.shell,
      stdinCommand: fromStdin ? command : undefined,
    });
  }
  const [first, ...rest] = command;
  if (first === undefined) {
    return err<Invocation, nodeExecTypes.ExecutionError>(
      new ExecutionError("spawn_error", "Empty argv: no program to run"),
    );
  }
  return ok<Invocation, nodeExecTypes.ExecutionError>({
    args: rest,
    program: first,
    stdinCommand: undefined,
  });
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
  target: nodeExecTypes.ExecTarget,
  options: typesModule.ShellExecOptions | undefined,
): NodeJS.ProcessEnv =>
  options?.inheritEnv === false
    ? { ...options.env }
    : { ...process.env, ...target.shellEnv, ...options?.env };

const executeIn = Effect.fnUntraced(function* (
  target: nodeExecTypes.ExecTarget,
  command: string | readonly string[],
  options: typesModule.ShellExecOptions | undefined,
  context: chordTypes.Context,
) {
  if (context.abortSignal?.aborted === true) {
    return err<typesModule.ShellExecResult, nodeExecTypes.ExecutionError>(
      new ExecutionError("aborted", "aborted"),
    );
  }
  const timeoutMs = resolveTimeoutMs(options?.timeout);
  if (!timeoutMs.ok)
    return err<typesModule.ShellExecResult, nodeExecTypes.ExecutionError>(timeoutMs.error);
  const cwd =
    options?.cwd === undefined || options.cwd === ""
      ? target.cwd
      : resolvePath(target.cwd, options.cwd);
  const invocation = yield* invocationOf(command, target.shellPath);
  if (!invocation.ok)
    return err<typesModule.ShellExecResult, nodeExecTypes.ExecutionError>(invocation.error);
  const missing = yield* missingWorkingDirectory(cwd);
  if (missing !== undefined)
    return err<typesModule.ShellExecResult, nodeExecTypes.ExecutionError>(missing);
  return yield* new ShellRun({
    ...invocation.value,
    activeChildPids: target.activeChildPids,
    context,
    createTempFile: target.createTempFile,
    cwd,
    env: shellEnvironment(target, options),
    onOutput: options?.onOutput,
    spill: options?.spill,
    timeout: options?.timeout,
    timeoutMs: timeoutMs.value,
  }).run();
});

const execute = ({
  target,
  command,
  options,
  context,
}: nodeExecTypes.ExecRequest): Promise<
  nodeExecTypes.Result<typesModule.ShellExecResult, nodeExecTypes.ExecutionError>
> => nodeRuntime.runPromise(executeIn(target, command, options, context));

const nodeExec = {
  execute,
};

export default nodeExec;
