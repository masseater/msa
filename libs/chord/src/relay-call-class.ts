import type connectionTypesModule from "./connection-types.types.ts";
import type relayTypes from "./relay.types.ts";

export default class RelayCall {
  readonly relay: relayTypes.RelayRef;
  readonly originId: number;
  readonly downId: number;
  readonly #pending: connectionTypesModule.Pending;
  #settled = false;

  constructor(
    relay: relayTypes.RelayRef,
    originId: number,
    downId: number,
    pending: connectionTypesModule.Pending,
  ) {
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
    if (forward) this.relay.down?.send({ id: this.downId, t: "cancel" });
    this.finish(error);
  }
}
