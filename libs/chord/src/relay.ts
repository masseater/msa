import { Effect } from "effect";

import type { StateFrame } from "./connection-types.ts";
import type { Connection } from "./connection.ts";
import { ChordError } from "./errors.ts";
import type { RelayCall } from "./relay-call.ts";
import { type Frame, toWireError } from "./wire.ts";

type Waiter = (outcome: Effect.Effect<Connection>) => void;

export class RelayRef {
  readonly origin: Connection;
  readonly frame: Extract<Frame, { t: "hold" }>;
  readonly principal: unknown;
  readonly originTag: string | undefined;
  readonly generation: number;
  down: Connection | undefined;
  downId = 0;
  closed = false;
  stateWanted: boolean;
  urgent: Set<string> | undefined;
  #shaped = false;
  readonly awaiting = new Set<string>();
  readonly calls = new Map<number, RelayCall>();
  readonly #waiters = new Set<Waiter>();

  constructor(
    origin: Connection,
    frame: Extract<Frame, { t: "hold" }>,
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

  ready(): Effect.Effect<Connection> {
    return Effect.suspend(() => {
      if (this.closed) return Effect.die(new ChordError("gone", "relayed hold closed"));
      if (this.down !== undefined) return Effect.succeed(this.down);
      return Effect.callback<Connection>((resume) => {
        this.#waiters.add(resume);
        return Effect.sync(() => this.#waiters.delete(resume));
      });
    });
  }

  open(down: Connection): void {
    if (this.closed) return;
    this.down = down;
    this.downId = down.nextId();
    down.relayedRefs.set(this.downId, this);
    const { at, token, input } = this.frame;
    down.send({
      t: "hold",
      id: this.downId,
      at,
      token,
      input,
      principal: this.principal,
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
    this.down?.send({ t: wanted ? "sub" : "unsub", hold: this.downId });
  }

  resync(m: string): void {
    if (this.closed) return;
    this.awaiting.add(m);
    this.down?.send({ t: "resync", hold: this.downId, m });
  }

  shape(frame: Extract<Frame, { t: "shape" }>): void {
    if (this.closed) return;
    if (!this.#shaped) {
      this.#shaped = true;
      if (this.frame.again !== true) this.urgent = new Set(frame.state);
    }
    this.origin.send({ ...frame, id: this.originId });
  }

  state(frame: StateFrame): void {
    if (this.closed) return;
    const m = frame.m;
    if (this.awaiting.has(m)) {
      if (frame.as === "ops") return;
      this.awaiting.delete(m);
    }
    const out: StateFrame = { ...frame, hold: this.originId };
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
      if (options.releaseDown) this.down.send({ t: "release", id: this.downId });
    }
    for (const waiter of this.#waiters) waiter(Effect.die(error));
    this.#waiters.clear();
    if (options.notify)
      this.origin.send({ t: "gone", id: this.originId, error: toWireError(error) });
  }
}
