import { type ChildProcess, fork } from "node:child_process";

import { Deferred, Effect } from "effect";

import { type IpcChannel, ipcLink } from "./link.ts";
import {
  type ControlMessage,
  controlOf,
  type Driver,
  type Exit,
  type ForkDriverOptions,
  ignoreSendError,
  type Instance,
  LOCK_ENV,
} from "./manager-types.ts";

type OutputTap = NonNullable<ForkDriverOptions["onOutput"]>;

function childEnv(options: ForkDriverOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[LOCK_ENV];
  Object.assign(env, options.env);
  if (options.lock !== undefined) env[LOCK_ENV] = options.lock;
  return env;
}

function forkChild(options: ForkDriverOptions): ChildProcess {
  const output = options.onOutput === undefined ? "inherit" : "pipe";
  return fork(options.entry, [...(options.args ?? [])], {
    env: childEnv(options),
    execArgv: [...(options.execArgv ?? [])],
    detached: true,
    stdio: ["ignore", output, output, "ipc"],
  });
}

function tapOutput(child: ChildProcess, onOutput: OutputTap): void {
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream]?.on("data", (chunk: Buffer) => {
      onOutput(stream, chunk);
      process[stream].write(chunk);
    });
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

function exitOf(child: ChildProcess, pid: number): Promise<Exit> {
  const exited = Deferred.makeUnsafe<Exit>();
  child.once("exit", (code, signal) => {
    killGroup(pid);
    Deferred.doneUnsafe(exited, Effect.succeed({ code, signal }));
  });
  return Effect.runPromise(Deferred.await(exited));
}

function controlListeners(
  child: ChildProcess,
  options: ForkDriverOptions,
): Set<(message: ControlMessage) => void> {
  const listeners = new Set<(message: ControlMessage) => void>();
  child.on("message", (message) => {
    options.onMessage?.(message);
    const control = controlOf(message);
    if (control !== undefined) for (const listener of listeners) listener(control);
  });
  return listeners;
}

function spawnInstance(options: ForkDriverOptions): Instance {
  const child = forkChild(options);
  if (options.onOutput !== undefined) tapOutput(child, options.onOutput);
  const pid = child.pid ?? -1;
  const exited = exitOf(child, pid);
  const listeners = controlListeners(child, options);
  const send = (message: ControlMessage): void => {
    if (child.connected) child.send({ chord2control: message }, ignoreSendError);
  };
  if (options.init !== undefined) send({ type: "init", value: options.init });
  return {
    pid,
    link: ipcLink(child as unknown as IpcChannel),
    exited,
    send,
    killTree: () => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
    onControl: (listener) => listeners.add(listener),
  };
}

export function forkDriver(options: ForkDriverOptions): Driver {
  return { spawn: () => spawnInstance(options) };
}
