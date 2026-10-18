import {
  type ChildProcess,
  type ChildProcessByStdio,
  execFile,
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type SpawnOptions,
  type SpawnOptionsWithStdioTuple,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
  type StdioNull,
  type StdioPipe,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";

import crossSpawn from "cross-spawn";

import { schedule, type Scheduled } from "../core/platform.ts";
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

export function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessByStdio<Writable, Readable, Readable>;
export function spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess;
export function spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return process.platform === "win32"
    ? crossSpawn(command, args, options)
    : nodeSpawn(command, args, options);
}

export function spawnProcessSync(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  return process.platform === "win32"
    ? crossSpawn.sync(command, args, options)
    : nodeSpawnSync(command, args, options);
}

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
