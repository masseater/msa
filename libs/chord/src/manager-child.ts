import { Config, Deferred, Effect, Option } from "effect";

import { ChordError } from "./errors.ts";
import { acquireProcessLock } from "./manager-lock.ts";
import { type ControlMessage, controlOf, ignoreSendError, LOCK_ENV } from "./manager-types.ts";

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

export function childControl(channel: NodeJS.Process = process): {
  readonly init: Promise<unknown>;
  lock(): Promise<void>;
  ready(): void;
  fatal(error: unknown): void;
  report(status: { activeCalls?: number; viewers?: number; durableTasks?: number }): void;
  onShutdown(handler: () => void | Promise<void>): void;
} {
  const send = (message: ControlMessage): void => {
    if (channel.connected)
      channel.send?.({ chord2control: message }, undefined, undefined, ignoreSendError);
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
