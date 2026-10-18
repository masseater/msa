import { Socket } from "node:net";

import * as NodeSink from "@effect/platform-node/NodeSink";
import * as NodeStream from "@effect/platform-node/NodeStream";
import { Config, Deferred, Effect, Option, Scope } from "effect";

import { ChordError } from "./errors.ts";
import { StreamChannel } from "./ipc-channel.ts";
import type { IpcChannel } from "./link-ipc.ts";
import { acquireProcessLock } from "./manager-lock.ts";
import {
  CHANNEL_FDS,
  type ControlMessage,
  controlOf,
  ignoreSendError,
  LOCK_ENV,
} from "./manager-types.ts";

const fatalMessage = (error: unknown): ControlMessage => ({
  type: "fatal",
  message: error instanceof Error ? error.message : String(error),
  ...(error instanceof ChordError && error.reason !== undefined ? { reason: error.reason } : {}),
});

const lockFromEnvironment = Effect.fn(function* (fatal: (error: unknown) => void) {
  const name = yield* Effect.orDie(Config.option(Config.String(LOCK_ENV)));
  if (Option.isNone(name)) return;
  yield* acquireProcessLock(name.value).pipe(
    Effect.tapDefect((error) => Effect.sync(() => fatal(error))),
  );
});

const openParentChannel = (): IpcChannel => {
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

let parent: IpcChannel | undefined;

export const parentChannel = (): IpcChannel => {
  parent ??= openParentChannel();
  return parent;
};

export function childControl(channel: IpcChannel = parentChannel()): {
  readonly init: Promise<unknown>;
  lock(): Promise<void>;
  ready(): void;
  fatal(error: unknown): void;
  report(status: { activeCalls?: number; viewers?: number; durableTasks?: number }): void;
  onShutdown(handler: () => void | Promise<void>): void;
} {
  const send = (message: ControlMessage): void => {
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
    init: Effect.runPromise(Deferred.await(init)),
    lock: () => Effect.runPromise(lockFromEnvironment(fatal)),
    ready: () => send({ type: "ready" }),
    fatal,
    report: (status) => send({ type: "status", ...status }),
    onShutdown: (handler) => shutdown.add(handler),
  };
}
