import { Effect } from "effect";

import type { Pending } from "./connection-types.ts";
import type { Connection } from "./connection.ts";
import { ChordError } from "./errors.ts";
import type { RelayRef } from "./relay.ts";
import type { Frame, RootRef } from "./wire.ts";

export class RelayCall {
  readonly relay: RelayRef;
  readonly originId: number;
  readonly downId: number;
  readonly #pending: Pending;
  #settled = false;

  constructor(relay: RelayRef, originId: number, downId: number, pending: Pending) {
    this.relay = relay;
    this.originId = originId;
    this.downId = downId;
    this.#pending = pending;
    relay.calls.set(originId, this);
    relay.down?.relayedCalls.set(downId, this);
  }

  finish(error: unknown, value?: unknown): void {
    if (this.#settled) return;
    this.#settled = true;
    this.relay.calls.delete(this.originId);
    this.relay.down?.relayedCalls.delete(this.downId);
    if (error === undefined) this.#pending.resolve(value);
    else this.#pending.reject(error);
  }

  cancel(error: unknown, forward: boolean): void {
    if (this.#settled) return;
    if (forward) this.relay.down?.send({ t: "cancel", id: this.downId });
    this.finish(error);
  }
}

export interface RelayRequest {
  readonly relay: RelayRef;
  readonly frame: Extract<Frame, { t: "call" }>;
  readonly root: RootRef;
  readonly signal: AbortSignal;
  readonly rootSent: (rootId: string, connection: Connection) => void;
}

const abortedWith = (signal: AbortSignal, error: () => unknown): Effect.Effect<never> =>
  Effect.callback<never>((resume) => {
    const abort = (): void => resume(Effect.die(error()));
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

export const relayCall = (request: RelayRequest): Effect.Effect<unknown> => {
  const { relay, frame, root, signal } = request;
  const abortError = (): ChordError =>
    new ChordError("aborted", "call cancelled", { cause: signal.reason });
  return Effect.gen(function* () {
    if (signal.aborted) throw abortError();
    const down = yield* Effect.raceFirst(relay.ready(), abortedWith(signal, abortError));
    if (relay.closed) throw new ChordError("gone", "relayed hold closed");
    let detach = (): void => {};
    return yield* Effect.callback<unknown>((resume) => {
      const call = new RelayCall(relay, frame.id, down.nextId(), {
        resolve: (value) => resume(Effect.succeed(value)),
        reject: (error) => resume(Effect.die(error)),
      });
      const cancel = (): void => call.cancel(abortError(), true);
      signal.addEventListener("abort", cancel, { once: true });
      detach = () => signal.removeEventListener("abort", cancel);
      request.rootSent(root.rootId, down);
      down.send({
        t: "call",
        id: call.downId,
        hold: relay.downId,
        member: frame.member,
        args: frame.args,
        root,
      });
    }).pipe(Effect.ensuring(Effect.sync(() => detach())));
  });
};
