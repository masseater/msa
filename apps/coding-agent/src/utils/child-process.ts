import {
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptions,
  type SpawnOptionsWithStdioTuple,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
  type StdioNull,
  type StdioPipe,
  execFile,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";

import crossSpawn from "cross-spawn";
import { dual } from "effect/Function";

import { type Scheduled, schedule } from "../core/platform.ts";
import { callbackPromise } from "./interop.ts";

export type { ChildProcess };

const EXIT_STDIO_GRACE_MS = 100;

export function execFileText(options: {
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

type PipedStdio = SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>;
type NullInputStdio = SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>;

function spawnProcessImpl(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return process.platform === "win32"
    ? crossSpawn(command, args, options)
    : nodeSpawn(command, args, options);
}

export const spawnProcess: {
  (
    command: string,
    args: string[],
    options: NullInputStdio,
  ): ChildProcessByStdio<null, Readable, Readable>;
  (
    command: string,
    args: string[],
    options: PipedStdio,
  ): ChildProcessByStdio<Writable, Readable, Readable>;
  (command: string, args: string[], options: SpawnOptions): ChildProcess;
  (
    args: string[],
    options: NullInputStdio,
  ): (command: string) => ChildProcessByStdio<null, Readable, Readable>;
  (
    args: string[],
    options: PipedStdio,
  ): (command: string) => ChildProcessByStdio<Writable, Readable, Readable>;
  (args: string[], options: SpawnOptions): (command: string) => ChildProcess;
} = dual((args: IArguments) => args.length >= 3, spawnProcessImpl);

function spawnProcessSyncImpl(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  return process.platform === "win32"
    ? crossSpawn.sync(command, args, options)
    : nodeSpawnSync(command, args, options);
}

export const spawnProcessSync: {
  (
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string>;
  (
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): (command: string) => SpawnSyncReturns<string>;
} = dual((args: IArguments) => args.length >= 3, spawnProcessSyncImpl);

export function waitForChildProcess(child: ChildProcess): Promise<number | null> {
  return callbackPromise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: Scheduled | undefined;
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
