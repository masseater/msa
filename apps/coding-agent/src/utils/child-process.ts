import { promisify } from "node:util";

import crossSpawn from "cross-spawn";
import { dual } from "effect/Function";

import nodeChildProcess from "../core/platform/node/child-process.ts";
import type nodeChildProcessTypes from "../core/platform/node/child-process.types.ts";
import type nodeStreamTypes from "../core/platform/node/stream.types.ts";
import ChildExit from "./child-exit.ts";
import interop from "./interop.ts";

const { execFile, spawn: nodeSpawn, spawnSync: nodeSpawnSync } = nodeChildProcess;

const { callbackPromise } = interop;

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
  return callbackPromise((resolve, reject) => new ChildExit(child, resolve, reject).attach());
}

const childProcess = {
  execFileText,
  spawnProcess,
  spawnProcessSync,
  waitForChildProcess,
};

export default childProcess;
