import { promisify } from "node:util";

import crossSpawn from "cross-spawn";
import { dual } from "effect/Function";

import platformModule from "../core/platform.ts";
import type platformTypes from "../core/platform.types.ts";
import nodeChildProcess from "../core/platform/node/child-process.ts";
import type nodeChildProcessTypes from "../core/platform/node/child-process.types.ts";
import type nodeStreamTypes from "../core/platform/node/stream.types.ts";
import interop from "./interop.ts";

const { execFile, spawn: nodeSpawn, spawnSync: nodeSpawnSync } = nodeChildProcess;

const { callbackPromise } = interop;
const { schedule } = platformModule;

const EXIT_STDIO_GRACE_MS = 100;

function execFileText(options: {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}): Promise<{ stdout: string; stderr: string }> {
  return promisify(execFile)(options.command, options.args, {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    encoding: "utf8",
  });
}

type PipedStdio = nodeChildProcessTypes.SpawnOptionsWithStdioTuple<
  nodeChildProcessTypes.StdioPipe,
  nodeChildProcessTypes.StdioPipe,
  nodeChildProcessTypes.StdioPipe
>;
type NullInputStdio = nodeChildProcessTypes.SpawnOptionsWithStdioTuple<
  nodeChildProcessTypes.StdioNull,
  nodeChildProcessTypes.StdioPipe,
  nodeChildProcessTypes.StdioPipe
>;

function spawnProcessImpl(
  command: string,
  args: string[],
  options: nodeChildProcessTypes.SpawnOptions,
): nodeChildProcessTypes.ChildProcess {
  return process.platform === "win32"
    ? crossSpawn(command, args, options)
    : nodeSpawn(command, args, options);
}

const spawnProcess: {
  (
    command: string,
    args: string[],
    options: NullInputStdio,
  ): nodeChildProcessTypes.ChildProcessByStdio<
    null,
    nodeStreamTypes.Readable,
    nodeStreamTypes.Readable
  >;
  (
    command: string,
    args: string[],
    options: PipedStdio,
  ): nodeChildProcessTypes.ChildProcessByStdio<
    nodeStreamTypes.Writable,
    nodeStreamTypes.Readable,
    nodeStreamTypes.Readable
  >;
  (
    command: string,
    args: string[],
    options: nodeChildProcessTypes.SpawnOptions,
  ): nodeChildProcessTypes.ChildProcess;
  (
    args: string[],
    options: NullInputStdio,
  ): (
    command: string,
  ) => nodeChildProcessTypes.ChildProcessByStdio<
    null,
    nodeStreamTypes.Readable,
    nodeStreamTypes.Readable
  >;
  (
    args: string[],
    options: PipedStdio,
  ): (
    command: string,
  ) => nodeChildProcessTypes.ChildProcessByStdio<
    nodeStreamTypes.Writable,
    nodeStreamTypes.Readable,
    nodeStreamTypes.Readable
  >;
  (
    args: string[],
    options: nodeChildProcessTypes.SpawnOptions,
  ): (command: string) => nodeChildProcessTypes.ChildProcess;
} = dual((args: IArguments) => args.length >= 3, spawnProcessImpl);

function spawnProcessSyncImpl(
  command: string,
  args: string[],
  options: nodeChildProcessTypes.SpawnSyncOptionsWithStringEncoding,
): nodeChildProcessTypes.SpawnSyncReturns<string> {
  return process.platform === "win32"
    ? crossSpawn.sync(command, args, options)
    : nodeSpawnSync(command, args, options);
}

const spawnProcessSync: {
  (
    command: string,
    args: string[],
    options: nodeChildProcessTypes.SpawnSyncOptionsWithStringEncoding,
  ): nodeChildProcessTypes.SpawnSyncReturns<string>;
  (
    args: string[],
    options: nodeChildProcessTypes.SpawnSyncOptionsWithStringEncoding,
  ): (command: string) => nodeChildProcessTypes.SpawnSyncReturns<string>;
} = dual((args: IArguments) => args.length >= 3, spawnProcessSyncImpl);

function waitForChildProcess(child: nodeChildProcessTypes.ChildProcess): Promise<number | null> {
  return callbackPromise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: platformTypes.Scheduled | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;

    const cleanup = () => {
      if (postExitTimer !== undefined) {
        postExitTimer.cancel();
        postExitTimer = undefined;
      }
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };

    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(code);
    };

    const maybeFinalizeAfterExit = () => {
      if (!exited || settled) return;
      if (stdoutEnded && stderrEnded) {
        finalize(exitCode);
      }
    };

    const armIdleTimer = () => {
      postExitTimer?.cancel();
      postExitTimer = schedule(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
    };

    const onData = () => {
      if (exited && !settled) armIdleTimer();
    };

    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };

    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onExit = (code: number | null) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
      if (!settled) {
        armIdleTimer();
      }
    };

    const onClose = (code: number | null) => {
      finalize(code);
    };

    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}

const childProcess = {
  execFileText,
  spawnProcess,
  spawnProcessSync,
  waitForChildProcess,
};

export default childProcess;
