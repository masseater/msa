import { Socket } from "node:net";

import * as NodeSink from "@effect/platform-node/NodeSink";
import * as NodeStream from "@effect/platform-node/NodeStream";
import { Config, Deferred, Effect, Option, Scope } from "effect";

import errorsModule from "./errors.ts";
import StreamChannel from "./ipc-channel.ts";
import type linkIpcTypes from "./link-ipc.types.ts";
import managerLock from "./manager-lock.ts";
import managerTypes from "./manager-types.ts";
import type managerTypesModule from "./manager-types.types.ts";

const { ChordError } = errorsModule;
const { CHANNEL_FDS, LOCK_ENV, controlOf, ignoreSendError } = managerTypes;
const { acquireProcessLock } = managerLock;

const fatalMessage = (error: unknown): managerTypesModule.ControlMessage => ({
  message: error instanceof Error ? error.message : String(error),
  type: "fatal",
  ...(error instanceof ChordError && error.reason !== undefined ? { reason: error.reason } : {}),
});

const lockFromEnvironment = Effect.fn(function* (fatal: (error: unknown) => void) {
  const name = yield* Effect.orDie(Config.option(Config.String(LOCK_ENV)));
  if (Option.isNone(name)) return;
  yield* acquireProcessLock(name.value).pipe(
    Effect.tapDefect((error) => Effect.sync(() => fatal(error))),
  );
});

const openParentChannel = (): linkIpcTypes.IpcChannel => {
  const channel = new StreamChannel();
  const incoming = NodeStream.fromReadable({
    evaluate: () => new Socket({ fd: CHANNEL_FDS.toChild, readable: true, writable: false }),
  });
  const outgoing = NodeSink.fromWritable({
    evaluate: () => new Socket({ fd: CHANNEL_FDS.toParent, readable: false, writable: true }),
    onError: (error) => error,
  });
  Effect.runSync(Scope.provide(channel.run(incoming, outgoing), Scope.makeUnsafe()));
  return channel;
};

let parent: linkIpcTypes.IpcChannel | undefined;

const parentChannel = (): linkIpcTypes.IpcChannel => {
  parent ??= openParentChannel();
  return parent;
};

function childControl(channel: linkIpcTypes.IpcChannel = parentChannel()): {
  readonly init: Promise<unknown>;
  lock(): Promise<void>;
  ready(): void;
  fatal(error: unknown): void;
  report(status: { activeCalls?: number; viewers?: number; durableTasks?: number }): void;
  onShutdown(handler: () => void | Promise<void>): void;
} {
  const send = (message: managerTypesModule.ControlMessage): void => {
    if (channel.connected) channel.send({ chord2control: message }, ignoreSendError);
  };
  const init = Deferred.makeUnsafe<unknown>();
  const shutdown = new Set<() => void | Promise<void>>();
  channel.on("message", (message: unknown) => {
    const control = controlOf(message);
    if (control?.type === "init") Deferred.doneUnsafe(init, Effect.succeed(control.value));
    if (control?.type === "shutdown") for (const handler of shutdown) void handler();
  });
  const fatal = (error: unknown): void => send(fatalMessage(error));
  return {
    fatal,
    init: Effect.runPromise(Deferred.await(init)),
    lock: () => Effect.runPromise(lockFromEnvironment(fatal)),
    onShutdown: (handler) => shutdown.add(handler),
    ready: () => send({ type: "ready" }),
    report: (status) => send({ type: "status", ...status }),
  };
}

const managerChild = {
  childControl,
  parentChannel,
};

export default managerChild;
