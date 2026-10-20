import type connectionFlowTypes from "./connection-flow.types.ts";
import type connectionTypesModule from "./connection-types.types.ts";
import type wireTypes from "./wire.types.ts";

const DEFAULT_WINDOW = 256 * 1024;
const PENDING_WINDOWS = 4;

type StateSlot = {
  readonly kind: "state";
  readonly hold: number;
  readonly m: string;
  base: connectionTypesModule.StateFrame | undefined;
  ops: (readonly unknown[])[];
  size: number;
  lazy: boolean;
  readonly overflow: connectionTypesModule.Overflow;
};

type Slot =
  | { readonly kind: "unit"; readonly hold: number; readonly flush: () => void }
  | StateSlot;

const stateKey = (hold: number, m: string): string => `s${hold}\u0000${m}`;
const unitKey = (hold: number): string => `u${hold}`;

export default class ConnectionFlow {
  readonly #owner: connectionFlowTypes.FlowOwner;
  readonly #window: number;
  readonly #pendingCap: number;
  #peerAcks: boolean | undefined;
  #sent = 0;
  #acked = 0;
  #unacked: number[] = [];
  #unackedBytes = 0;
  readonly #pending = new Map<string, Slot>();
  #pendingBytes = 0;
  #received = 0;
  #ackTimer: (() => void) | undefined;

  constructor(owner: connectionFlowTypes.FlowOwner, options: connectionTypesModule.LinkOptions) {
    this.#owner = owner;
    this.#window = options.window ?? DEFAULT_WINDOW;
    this.#pendingCap = options.pendingCap ?? this.#window * PENDING_WINDOWS;
  }

  peerAcks(acks: boolean): void {
    if (this.#peerAcks !== undefined) return;
    this.#peerAcks = acks;
    if (!acks) {
      this.#unacked = [];
      this.#unackedBytes = 0;
    }
  }

  send(frame: wireTypes.Frame): void {
    const size = this.#owner.link.send(frame) ?? 0;
    if (this.#peerAcks === false) return;
    this.#sent += 1;
    this.#unacked.push(size);
    this.#unackedBytes += size;
  }

  sendState(
    frame: connectionTypesModule.StateFrame,
    overflow: connectionTypesModule.Overflow,
  ): void {
    const key = stateKey(frame.hold, frame.m);
    let slot = this.#pending.get(key);
    if (slot === undefined && !this.#full) {
      this.send(frame);
      return;
    }
    if (slot?.kind === "unit") return;
    if (slot === undefined) {
      slot = {
        base: undefined,
        hold: frame.hold,
        kind: "state",
        lazy: false,
        m: frame.m,
        ops: [],
        overflow,
        size: 0,
      };
      this.#pending.set(key, slot);
    }
    if (frame.as !== "ops") {
      this.#pendingBytes -= slot.size;
      slot.base = frame;
      slot.ops = [];
      slot.size = 0;
      slot.lazy = false;
      return;
    }
    if (slot.lazy) return;
    const size = JSON.stringify(frame.ops).length;
    if (this.#pendingBytes + size > this.#pendingCap) this.#makeRoom(size, slot);
    if (slot.lazy || this.#pending.get(key) !== slot) return;
    for (const op of frame.ops ?? []) slot.ops.push(op);
    slot.size += size;
    this.#pendingBytes += size;
  }

  #makeRoom(size: number, current: StateSlot): void {
    for (const slot of [...this.#pending.values()]) {
      if (this.#pendingBytes + size <= this.#pendingCap) return;
      if (slot.kind === "state" && slot !== current && slot.size > 0) this.#drop(slot);
    }
    if (this.#pendingBytes + size > this.#pendingCap) this.#drop(current);
  }

  #drop(slot: StateSlot): void {
    this.#pendingBytes -= slot.size;
    slot.base = undefined;
    slot.ops = [];
    slot.size = 0;
    if ("resend" in slot.overflow) {
      slot.lazy = true;
      return;
    }
    this.#pending.delete(stateKey(slot.hold, slot.m));
    slot.overflow.resync();
  }

  resetLater(hold: number, m: string, resend: () => void): void {
    const key = stateKey(hold, m);
    const slot = this.#pending.get(key);
    if (slot?.kind === "unit") return;
    if (slot === undefined) {
      this.#pending.set(key, {
        base: undefined,
        hold,
        kind: "state",
        lazy: true,
        m,
        ops: [],
        overflow: { resend },
        size: 0,
      });
    } else {
      this.#pendingBytes -= slot.size;
      slot.base = undefined;
      slot.ops = [];
      slot.size = 0;
      slot.lazy = true;
    }
    this.#flush();
  }

  queueUnit(hold: number, flush: () => void): void {
    const key = unitKey(hold);
    if (!this.#pending.has(key)) this.#pending.set(key, { flush, hold, kind: "unit" });
    this.#flush();
  }

  unitSent(hold: number): void {
    this.#pending.delete(unitKey(hold));
  }

  dropState(hold: number, m: string): void {
    const slot = this.#pending.get(stateKey(hold, m));
    if (slot?.kind !== "state") return;
    this.#pendingBytes -= slot.size;
    this.#pending.delete(stateKey(hold, m));
  }

  dropHoldState(hold: number): void {
    for (const [key, slot] of this.#pending) {
      if (slot.hold !== hold) continue;
      if (slot.kind === "state") this.#pendingBytes -= slot.size;
      this.#pending.delete(key);
    }
  }

  get waiting(): { readonly slots: number; readonly bytes: number } {
    return { bytes: this.#pendingBytes, slots: this.#pending.size };
  }

  get #full(): boolean {
    return this.#peerAcks === true && this.#unackedBytes >= this.#window;
  }

  onAck(n: number): void {
    if (this.#peerAcks !== true || n < this.#acked || n > this.#sent) {
      this.#owner.violation(`ack ${n} outside ${this.#acked}..${this.#sent}`);
      return;
    }
    for (const size of this.#unacked.splice(0, n - this.#acked)) this.#unackedBytes -= size;
    this.#acked = n;
    this.#flush();
  }

  received(): void {
    this.#received += 1;
  }

  #flush(): void {
    for (const [key, slot] of this.#pending) {
      if (this.#full) return;
      this.#pending.delete(key);
      if (slot.kind === "unit") {
        slot.flush();
        continue;
      }
      this.#pendingBytes -= slot.size;
      if (slot.lazy) {
        if ("resend" in slot.overflow) slot.overflow.resend();
        continue;
      }
      if (slot.base !== undefined) this.send(slot.base);
      if (slot.ops.length > 0)
        this.send({ as: "ops", hold: slot.hold, m: slot.m, ops: slot.ops, t: "state" });
    }
  }

  scheduleAck(): void {
    if (this.#peerAcks !== true || this.#ackTimer !== undefined || !this.#owner.open) return;
    this.#ackTimer = this.#owner.timers.after(0, () => {
      this.#ackTimer = undefined;
      this.#owner.link.send({ n: this.#received, t: "ack" });
    });
  }

  close(): void {
    this.#ackTimer?.();
    this.#pending.clear();
    this.#pendingBytes = 0;
  }
}
