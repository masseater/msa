import { Effect } from "effect";

import type connectionTypesModule from "./connection-types.types.ts";
import type connectionTypes from "./connection.types.ts";
import errorsModule from "./errors.ts";
import type relayCallTypes from "./relay-call.types.ts";
import wire from "./wire.ts";
import type wireTypes from "./wire.types.ts";

const { ChordError } = errorsModule;
const { toWireError } = wire;

type Waiter = (outcome: Effect.Effect<connectionTypes.Connection>) => void;

export default class RelayRef {
  readonly origin: connectionTypes.Connection;
  readonly frame: Extract<wireTypes.Frame, { t: "hold" }>;
  readonly principal: unknown;
  readonly originTag: string | undefined;
  readonly generation: number;
  down: connectionTypes.Connection | undefined;
  downId = 0;
  closed = false;
  stateWanted: boolean;
  urgent: Set<string> | undefined;
  #shaped = false;
  readonly awaiting = new Set<string>();
  readonly calls = new Map<number, relayCallTypes.RelayCall>();
  readonly #waiters = new Set<Waiter>();

  constructor(
    origin: connectionTypes.Connection,
    frame: Extract<wireTypes.Frame, { t: "hold" }>,
    principal: unknown,
    originTag: string | undefined,
  ) {
    this.origin = origin;
    this.frame = frame;
    this.principal = principal;
    this.originTag = originTag;
    this.stateWanted = frame.state !== false;
    this.generation = origin.generation;
  }

  get originId(): number {
    return this.frame.id;
  }

  get client(): boolean {
    return this.originTag !== undefined;
  }

  get current(): boolean {
    return !this.closed && this.origin.open && this.origin.generation === this.generation;
  }

  ready(): Effect.Effect<connectionTypes.Connection> {
    return Effect.suspend(() => {
      if (this.closed) return Effect.die(new ChordError("gone", "relayed hold closed"));
      if (this.down !== undefined) return Effect.succeed(this.down);
      return Effect.callback<connectionTypes.Connection>((resume) => {
        this.#waiters.add(resume);
        return Effect.sync(() => this.#waiters.delete(resume));
      });
    });
  }

  open(down: connectionTypes.Connection): void {
    if (this.closed) return;
    this.down = down;
    this.downId = down.nextId();
    down.relayedRefs.set(this.downId, this);
    const { at, token, input } = this.frame;
    down.send({
      at,
      id: this.downId,
      input,
      principal: this.principal,
      t: "hold",
      token,
      ...(this.originTag === undefined ? {} : { origin: this.originTag }),
      ...(this.stateWanted ? {} : { state: false as const }),
      ...(this.frame.again === true ? { again: true as const } : {}),
    });
    for (const waiter of this.#waiters) waiter(Effect.succeed(down));
    this.#waiters.clear();
  }

  wantState(wanted: boolean): void {
    if (this.closed || wanted === this.stateWanted) return;
    this.stateWanted = wanted;
    if (!wanted) {
      this.origin.flow.dropHoldState(this.originId);
      this.awaiting.clear();
    }
    this.down?.send({ hold: this.downId, t: wanted ? "sub" : "unsub" });
  }

  resync(m: string): void {
    if (this.closed) return;
    this.awaiting.add(m);
    this.down?.send({ hold: this.downId, m, t: "resync" });
  }

  shape(frame: Extract<wireTypes.Frame, { t: "shape" }>): void {
    if (this.closed) return;
    if (!this.#shaped) {
      this.#shaped = true;
      if (this.frame.again !== true) this.urgent = new Set(frame.state);
    }
    this.origin.send({ ...frame, id: this.originId });
  }

  state(frame: connectionTypesModule.StateFrame): void {
    if (this.closed) return;
    const m = frame.m;
    if (this.awaiting.has(m)) {
      if (frame.as === "ops") return;
      this.awaiting.delete(m);
    }
    const out: connectionTypesModule.StateFrame = { ...frame, hold: this.originId };
    if (this.urgent?.delete(m) === true) {
      this.origin.send(out);
      return;
    }
    this.origin.flow.sendState(out, { resync: () => this.resync(m) });
  }

  close(
    error: unknown,
    options: { readonly releaseDown: boolean; readonly notify: boolean },
  ): void {
    if (this.closed) return;
    this.closed = true;
    for (const call of [...this.calls.values()]) call.cancel(error, options.releaseDown);
    this.origin.flow.dropHoldState(this.originId);
    if (this.origin.served.get(this.originId)?.kind === "relay")
      this.origin.served.delete(this.originId);
    if (this.down !== undefined) {
      this.down.relayedRefs.delete(this.downId);
      if (options.releaseDown) this.down.send({ id: this.downId, t: "release" });
    }
    for (const waiter of this.#waiters) waiter(Effect.die(error));
    this.#waiters.clear();
    if (options.notify)
      this.origin.send({ error: toWireError(error), id: this.originId, t: "gone" });
  }
}
