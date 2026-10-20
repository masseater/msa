import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
  Deferred,
  Effect,
  Exit as EffectExit,
  Layer,
  ManagedRuntime,
  type PlatformError,
  Stream,
} from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

import StreamChannel from "./ipc-channel.ts";
import type ipcChannelTypes from "./ipc-channel.types.ts";
import linkModule from "./link.ts";
import managerTypes from "./manager-types.ts";
import type managerTypesModule from "./manager-types.types.ts";

const { CHANNEL_FDS, LOCK_ENV, controlOf, ignoreSendError } = managerTypes;
const { ipcLink } = linkModule;

const runtime = ManagedRuntime.make(
  Layer.provideMerge(
    NodeChildProcessSpawner.layer,
    Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
  ),
);

type Handle = ChildProcessSpawner.ChildProcessHandle;
type OutputTap = NonNullable<managerTypesModule.ForkDriverOptions["onOutput"]>;

function childEnv(
  options: managerTypesModule.ForkDriverOptions,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[LOCK_ENV];
  Object.assign(env, options.env);
  if (options.lock !== undefined) env[LOCK_ENV] = options.lock;
  return env;
}

const childCommand = (options: managerTypesModule.ForkDriverOptions) => {
  const output = options.onOutput === undefined ? "inherit" : "pipe";
  return ChildProcess.make(
    process.execPath,
    [...(options.execArgv ?? []), options.entry, ...(options.args ?? [])],
    {
      additionalFds: {
        [`fd${CHANNEL_FDS.toChild}` as const]: { type: "input" },
        [`fd${CHANNEL_FDS.toParent}` as const]: { type: "output" },
      },
      detached: true,
      env: childEnv(options),
      extendEnv: false,
      killSignal: "SIGKILL",
      stderr: output,
      stdin: "ignore",
      stdout: output,
    },
  );
};

const tapOutput = (handle: Handle, onOutput: OutputTap) =>
  Effect.forEach(
    ["stdout", "stderr"] as const,
    (stream) =>
      Effect.forkScoped(
        Stream.runForEach(handle[stream], (chunk) =>
          Effect.sync(() => {
            onOutput(stream, chunk);
            process[stream].write(chunk);
          }),
        ),
      ),
    { discard: true },
  );

const signalOf = (error: unknown): string =>
  /signal: '(?<signal>\w+)'/u.exec(String((error as { cause?: unknown }).cause))?.groups?.[
    "signal"
  ] ?? String(error);

const exitOf = (handle: Handle): Effect.Effect<managerTypesModule.Exit> =>
  handle.exitCode.pipe(
    Effect.map((code): managerTypesModule.Exit => ({ code, signal: null })),
    Effect.catch((error) =>
      Effect.succeed<managerTypesModule.Exit>({ code: null, signal: signalOf(error) }),
    ),
  );

function controlListeners(
  channel: ipcChannelTypes.StreamChannel,
  options: managerTypesModule.ForkDriverOptions,
): Set<(message: managerTypesModule.ControlMessage) => void> {
  const listeners = new Set<(message: managerTypesModule.ControlMessage) => void>();
  channel.on("message", (message) => {
    options.onMessage?.(message);
    const control = controlOf(message);
    if (control !== undefined) for (const listener of listeners) listener(control);
  });
  return listeners;
}

function instanceOf(
  handle: Handle,
  channel: ipcChannelTypes.StreamChannel,
  options: managerTypesModule.ForkDriverOptions,
) {
  const listeners = controlListeners(channel, options);
  const send = (message: managerTypesModule.ControlMessage): void => {
    if (channel.connected) channel.send({ chord2control: message }, ignoreSendError);
  };
  if (options.init !== undefined) send({ type: "init", value: options.init });
  return (exited: Promise<managerTypesModule.Exit>): managerTypesModule.Instance => ({
    exited,
    killTree: () => {
      Effect.runFork(Effect.ignore(handle.kill({ killSignal: "SIGKILL" })));
    },
    link: ipcLink(channel),
    onControl: (listener) => listeners.add(listener),
    pid: handle.pid,
    send,
  });
}

type Started = (exited: Promise<managerTypesModule.Exit>) => managerTypesModule.Instance;

const runChild = (
  options: managerTypesModule.ForkDriverOptions,
  started: Deferred.Deferred<Started, PlatformError.PlatformError>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* childCommand(options);
      const channel = new StreamChannel();
      yield* channel.run(
        handle.getOutputFd(CHANNEL_FDS.toParent),
        handle.getInputFd(CHANNEL_FDS.toChild),
      );
      if (options.onOutput !== undefined) yield* tapOutput(handle, options.onOutput);
      yield* Deferred.succeed(started, instanceOf(handle, channel, options));
      return yield* exitOf(handle);
    }),
  );

const spawnInstance = Effect.fn(function* (options: managerTypesModule.ForkDriverOptions) {
  const started = yield* Deferred.make<Started, PlatformError.PlatformError>();
  const exited = yield* Deferred.make<managerTypesModule.Exit>();
  yield* Effect.forkDetach(
    runtime.contextEffect.pipe(
      Effect.flatMap((context) => Effect.provideContext(runChild(options, started), context)),
      Effect.onExit((exit) =>
        EffectExit.isSuccess(exit)
          ? Deferred.succeed(exited, exit.value)
          : Deferred.failCause(started, exit.cause),
      ),
    ),
  );
  return [yield* Deferred.await(started), exited] as const;
});

function forkDriver(options: managerTypesModule.ForkDriverOptions): managerTypesModule.Driver {
  return {
    spawn: () =>
      Effect.runPromise(Effect.orDie(spawnInstance(options))).then(([instance, exited]) =>
        instance(Effect.runPromise(Deferred.await(exited))),
      ),
  };
}

const managerFork = {
  forkDriver,
};

export default managerFork;
