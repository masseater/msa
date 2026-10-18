import { Clock, Effect } from "effect";

import { FrameDispatch } from "./connection-dispatch.ts";
import { ConnectionFlow } from "./connection-flow.ts";
import type {
  ConnectionConfig,
  Link,
  Peer,
  Pending,
  RelayCall,
  RelayRef,
  Served,
} from "./connection-types.ts";
import { ChordError } from "./errors.ts";
import type { HostLinks } from "./host-links.ts";
import type { RemoteBinding, RemoteCall, RemoteChannel } from "./remote.ts";
import { ServedHolds } from "./served.ts";
import type { HostTimers } from "./timers.ts";
import { type Frame, isFrame, PROTOCOL_VERSION } from "./wire.ts";

export type { AcceptOptions, LinkOptions, Peer, RelayRef } from "./connection-types.ts";

type SyncWaiter = (outcome: Effect.Effect<void>) => void;

const unavailable = (message: string): ChordError => new ChordError("unavailable", message);
const now = (): number => Effect.runSync(Clock.currentTimeMillis);

export class Connection implements RemoteChannel {
  readonly host: HostLinks;
  readonly link: Link;
  readonly role: "upstream" | "downstream";
  readonly peer: Peer;
  readonly originId: string | undefined;
  principal: unknown;
  readonly restamp: ((principal: unknown) => unknown | undefined) | undefined;
  generation = 0;
  peerCodeVersion: number | undefined;
  synced: boolean;
  readonly fencedCodeVersions = new Set<number>();
  readonly admitted = new Map<string, number>();
  parentName: string | undefined;
  readonly maxCalls: number;
  readonly flow: ConnectionFlow;
  readonly holds: ServedHolds;
  readonly remotes = new Map<number, RemoteBinding>();
  readonly calls = new Map<number, Pending>();
  readonly served = new Map<number, Served>();
  readonly incoming = new Map<number, AbortController>();
  readonly relayedRefs = new Map<number, RelayRef>();
  readonly relayedCalls = new Map<number, RelayCall>();
  readonly votes = new Map<number, Pending>();
  readonly #dispatch: FrameDispatch;
  readonly #syncWaiters = new Set<SyncWaiter>();
  readonly #onProtocolMismatch: ConnectionConfig["onProtocolMismatch"];
  #nextId = 1;
  #lastSeen = now();
  #stopPinger: (() => void) | undefined;
  #mismatched = false;

  constructor(host: HostLinks, link: Link, config: ConnectionConfig) {
    this.host = host;
    this.link = link;
    this.role = config.role;
    this.peer = config.peer;
    this.originId = config.originId;
    this.principal = config.principal;
    this.restamp = config.restamp;
    this.synced = !(this.role === "downstream" && this.peer.kind === "host");
    this.maxCalls = config.maxCalls ?? Number.POSITIVE_INFINITY;
    this.#onProtocolMismatch = config.onProtocolMismatch;
    this.flow = new ConnectionFlow(this, config);
    this.holds = new ServedHolds(this);
    this.#dispatch = new FrameDispatch(this);
    link.onClose((reason) => this.#closed(reason));
    link.receive((frame) => this.#receive(frame));
    this.send({
      t: "hello",
      protocol: PROTOCOL_VERSION,
      name: host.name,
      kind: host.kind,
      codeVersion: host.current.id,
      acks: true,
    });
    if (!link.closed)
      this.#startPinger(config.pingInterval ?? 15_000, config.pingTimeout ?? 45_000);
  }

  #startPinger(interval: number, timeout: number): void {
    let n = 0;
    this.#stopPinger = this.host.timers.every(interval, () => {
      if (now() - this.#lastSeen > timeout) this.link.close("ping timeout");
      else {
        n += 1;
        this.send({ t: "ping", n });
      }
    });
  }

  get timers(): HostTimers {
    return this.host.timers;
  }

  get open(): boolean {
    return !this.link.closed;
  }

  get name(): string | undefined {
    return this.role === "upstream" ? this.parentName : this.peer.name;
  }

  get waiting(): { readonly slots: number; readonly bytes: number } {
    return this.flow.waiting;
  }

  send(frame: Frame): void {
    this.flow.send(frame);
  }

  nextId(): number {
    const id = this.#nextId;
    this.#nextId += 1;
    return id;
  }

  whenSynced(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (!this.open) return Effect.die(unavailable(`link to ${this.name ?? "peer"} closed`));
      if (this.synced) return Effect.void;
      return Effect.callback<void>((resume) => {
        this.#syncWaiters.add(resume);
        return Effect.sync(() => this.#syncWaiters.delete(resume));
      });
    });
  }

  markSynced(codeVersion: number): void {
    this.peerCodeVersion = codeVersion;
    this.synced = true;
    for (const waiter of this.#syncWaiters) waiter(Effect.void);
    this.#syncWaiters.clear();
  }

  revoke(next: unknown): void {
    this.generation += 1;
    const error = new ChordError("gone", "principal invalidated");
    for (const served of [...this.served.values()]) {
      if (served.kind === "relay") served.relay.close(error, { releaseDown: true, notify: true });
    }
    if (next === undefined) this.link.close("principal invalidated");
    else this.principal = next;
  }

  protocolMismatch(peer: number | undefined, close = true): void {
    if (this.#mismatched) return;
    this.#mismatched = true;
    try {
      this.#onProtocolMismatch?.({ local: PROTOCOL_VERSION, peer });
    } catch (error) {
      this.host.report(error);
    }
    if (close) this.link.close(`protocol-version ${PROTOCOL_VERSION}`);
  }

  violation(reason: string): void {
    this.host.report(
      new ChordError("invalid", `link to ${this.name ?? "peer"}: ${reason}`, {
        reason: "protocol",
      }),
    );
    this.link.close(`protocol error: ${reason}`);
  }

  hold(binding: RemoteBinding, again: boolean): number {
    const id = this.nextId();
    this.remotes.set(id, binding);
    binding.bound(this, id);
    const principal = binding.principal;
    this.send({
      t: "hold",
      id,
      at: binding.at,
      token: binding.contract.description,
      input: binding.input,
      ...(principal === undefined ? {} : { principal }),
      ...(binding.stateOn ? {} : { state: false as const }),
      ...(again ? { again: true as const } : {}),
    });
    return id;
  }

  release(id: number): void {
    this.remotes.delete(id);
    this.send({ t: "release", id });
  }

  wantState(hold: number, wanted: boolean): void {
    if (this.remotes.has(hold)) this.send({ t: wanted ? "sub" : "unsub", hold });
  }

  call(request: RemoteCall): Effect.Effect<unknown> {
    return Effect.suspend(() => {
      const { hold, member, args, root, signal } = request;
      const id = this.nextId();
      if (signal.aborted) return Effect.die(new ChordError("aborted", "call aborted"));
      let detach = (): void => {};
      return Effect.callback<unknown>((resume) => {
        const onAbort = (): void => {
          this.calls.delete(id);
          this.send({ t: "cancel", id });
          resume(Effect.die(new ChordError("aborted", "call aborted", { cause: signal.reason })));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        detach = () => signal.removeEventListener("abort", onAbort);
        this.calls.set(id, {
          resolve: (value) => resume(Effect.succeed(value)),
          reject: (error) => resume(Effect.die(error)),
        });
        const carried = root !== undefined && this.host.kind === "host";
        if (carried) this.host.rootSent(root.rootId, this);
        this.send({ t: "call", id, hold, member, args, ...(carried ? { root } : {}) });
      }).pipe(Effect.ensuring(Effect.sync(() => detach())));
    });
  }

  #receive(frame: unknown): void {
    if (this.#mismatched) return;
    this.#lastSeen = now();
    if (!isFrame(frame)) {
      this.violation("malformed frame");
      return;
    }
    if (frame.t === "ack") {
      this.flow.onAck(frame.n);
      return;
    }
    this.flow.received();
    try {
      this.#dispatch.frame(frame);
    } catch (error) {
      this.host.report(error);
    }
    this.flow.scheduleAck();
  }

  #closed(reason: string): void {
    const told = /^protocol-version (\d+)$/u.exec(reason);
    if (told !== null && Number(told[1]) !== PROTOCOL_VERSION)
      this.protocolMismatch(Number(told[1]), false);
    this.#stopPinger?.();
    this.flow.close();
    const error = unavailable(`link to ${this.name ?? "peer"} closed: ${reason}`);
    for (const id of [...this.served.keys()]) this.holds.drop(id, true);
    for (const controller of this.incoming.values()) controller.abort(error);
    this.incoming.clear();
    this.#rejectWaiting(error);
    for (const relay of [...this.relayedRefs.values()])
      relay.close(error, { releaseDown: false, notify: true });
    this.relayedRefs.clear();
    this.relayedCalls.clear();
    const bindings = [...this.remotes.values()];
    this.remotes.clear();
    for (const binding of bindings) {
      if (this.role === "upstream") binding.detached();
      else binding.gone(error);
    }
    this.host.connectionClosed(this);
  }

  #rejectWaiting(error: ChordError): void {
    for (const pending of this.calls.values()) pending.reject(error);
    this.calls.clear();
    for (const vote of this.votes.values()) vote.reject(error);
    this.votes.clear();
    for (const waiter of this.#syncWaiters) waiter(Effect.die(error));
    this.#syncWaiters.clear();
  }
}
