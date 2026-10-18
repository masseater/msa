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

import { StreamChannel } from "./ipc-channel.ts";
import { ipcLink } from "./link.ts";
import {
  CHANNEL_FDS,
  type ControlMessage,
  controlOf,
  type Driver,
  type Exit,
  type ForkDriverOptions,
  ignoreSendError,
  type Instance,
  LOCK_ENV,
} from "./manager-types.ts";

const runtime = ManagedRuntime.make(
  Layer.provideMerge(
    NodeChildProcessSpawner.layer,
    Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
  ),
);

type Handle = ChildProcessSpawner.ChildProcessHandle;
type OutputTap = NonNullable<ForkDriverOptions["onOutput"]>;

function childEnv(options: ForkDriverOptions): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[LOCK_ENV];
  Object.assign(env, options.env);
  if (options.lock !== undefined) env[LOCK_ENV] = options.lock;
  return env;
}

const childCommand = (options: ForkDriverOptions) => {
  const output = options.onOutput === undefined ? "inherit" : "pipe";
  return ChildProcess.make(
    process.execPath,
    [...(options.execArgv ?? []), options.entry, ...(options.args ?? [])],
    {
      env: childEnv(options),
      extendEnv: false,
      detached: true,
      killSignal: "SIGKILL",
      stdin: "ignore",
      stdout: output,
      stderr: output,
      additionalFds: {
        [`fd${CHANNEL_FDS.toChild}` as const]: { type: "input" },
        [`fd${CHANNEL_FDS.toParent}` as const]: { type: "output" },
      },
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

const exitOf = (handle: Handle): Effect.Effect<Exit> =>
  handle.exitCode.pipe(
    Effect.map((code): Exit => ({ code, signal: null })),
    Effect.catch((error) => Effect.succeed<Exit>({ code: null, signal: signalOf(error) })),
  );

function controlListeners(
  channel: StreamChannel,
  options: ForkDriverOptions,
): Set<(message: ControlMessage) => void> {
  const listeners = new Set<(message: ControlMessage) => void>();
  channel.on("message", (message) => {
    options.onMessage?.(message);
    const control = controlOf(message);
    if (control !== undefined) for (const listener of listeners) listener(control);
  });
  return listeners;
}

function instanceOf(handle: Handle, channel: StreamChannel, options: ForkDriverOptions) {
  const listeners = controlListeners(channel, options);
  const send = (message: ControlMessage): void => {
    if (channel.connected) channel.send({ chord2control: message }, ignoreSendError);
  };
  if (options.init !== undefined) send({ type: "init", value: options.init });
  return (exited: Promise<Exit>): Instance => ({
    pid: handle.pid,
    link: ipcLink(channel),
    exited,
    send,
    killTree: () => {
      Effect.runFork(Effect.ignore(handle.kill({ killSignal: "SIGKILL" })));
    },
    onControl: (listener) => listeners.add(listener),
  });
}

type Started = (exited: Promise<Exit>) => Instance;

const runChild = (
  options: ForkDriverOptions,
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

const spawnInstance = Effect.fn(function* (options: ForkDriverOptions) {
  const started = yield* Deferred.make<Started, PlatformError.PlatformError>();
  const exited = yield* Deferred.make<Exit>();
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

export function forkDriver(options: ForkDriverOptions): Driver {
  return {
    spawn: () =>
      Effect.runPromise(Effect.orDie(spawnInstance(options))).then(([instance, exited]) =>
        instance(Effect.runPromise(Deferred.await(exited))),
      ),
  };
}
