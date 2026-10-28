import { Deferred, Effect } from "effect";

import type contractTypes from "./contract.types.ts";
import delta from "./delta/index.ts";
import errorsModule from "./errors.ts";
import type remoteRefTypes from "./remote-ref.types.ts";
import remoteShape from "./remote-shape.ts";
import type remoteTypesModule from "./remote-types.ts";
import type typesModule from "./types.types.ts";
import type viewReadableTypes from "./view-readable.types.ts";
import wire from "./wire.ts";

const { ChordError } = errorsModule;
const { fromWireError } = wire;
const { applyImmutable, decoder } = delta;
const { stateMembers } = remoteShape;

export default class RemoteBinding {
  readonly host: remoteTypesModule.RemoteHost;
  readonly key: string;
  readonly contract: contractTypes.AnyContract;
  readonly at: string;
  readonly input: unknown;
  readonly principal: unknown | undefined;
  status: "loading" | "live" | "ended" = "loading";
  error: unknown;
  shape: typesModule.Shape | undefined;
  hydrated = false;
  hold: { readonly channel: remoteTypesModule.RemoteChannel; readonly id: number } | undefined;
  stateOn = false;
  readonly views = new Set<remoteRefTypes.RemoteRef>();
  readonly members = new Map<string, remoteTypesModule.MemberState>();
  lingerTimer: (() => void) | undefined;
  readonly #listeners = new Map<string, Set<viewReadableTypes.ViewReadable>>();
  #pending:
    | {
        shape: typesModule.Shape;
        readonly missing: Set<string>;
        readonly values: Map<string, remoteTypesModule.MemberState>;
      }
    | undefined;
  #live = Deferred.makeUnsafe<void>();
  #applied = false;
  readonly #hydrationWaiters = new Set<remoteTypesModule.Settle>();

  constructor(
    host: remoteTypesModule.RemoteHost,
    fields: {
      key: string;
      contract: contractTypes.AnyContract;
      at: string;
      input: unknown;
      principal: unknown | undefined;
    },
  ) {
    this.host = host;
    this.key = fields.key;
    this.contract = fields.contract;
    this.at = fields.at;
    this.input = fields.input;
    this.principal = fields.principal;
  }

  get ended(): boolean {
    return this.status === "ended";
  }

  get stateViews(): number {
    let count = 0;
    for (const view of this.views) if (view.wantsState) count++;
    return count;
  }

  get wantsState(): boolean {
    return this.views.size === 0 ? this.stateOn : this.stateViews > 0;
  }

  get applied(): boolean {
    return this.#applied;
  }

  addView(view: remoteRefTypes.RemoteRef): void {
    this.views.add(view);
    if (this.lingerTimer !== undefined) {
      this.lingerTimer();
      this.lingerTimer = undefined;
    }
    this.#syncState();
    view.update();
  }

  removeView(view: remoteRefTypes.RemoteRef): void {
    if (!this.views.delete(view)) return;
    for (const set of this.#listeners.values())
      for (const readable of set) if (readable.view === view) set.delete(readable);
    if (this.views.size === 0) {
      this.host.bindingIdle(this);
      return;
    }
    this.#syncState();
  }

  #syncState(): void {
    if (this.ended || this.views.size === 0) return;
    const wanted = this.stateViews > 0;
    if (wanted === this.stateOn) return;
    this.stateOn = wanted;
    if (!wanted) {
      this.hydrated = false;
      this.members.clear();
      if (this.#pending !== undefined) this.#pending.missing.clear();
    }
    if (this.hold !== undefined) this.hold.channel.wantState(this.hold.id, wanted);
    for (const view of this.views) view.update();
  }

  listen(name: string, readable: viewReadableTypes.ViewReadable): void {
    let set = this.#listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(name, set);
    }
    set.add(readable);
  }

  unlisten(name: string, readable: viewReadableTypes.ViewReadable): void {
    this.#listeners.get(name)?.delete(readable);
  }

  inVariant(name: string): boolean {
    const variant = this.shape?.variant;
    return (
      variant !== undefined && this.contract.description.variants[variant]?.[name]?.kind === "state"
    );
  }

  read(name: string): unknown {
    if (this.status === "ended") throw this.terminalError();
    if (!this.hydrated)
      throw ChordError.create("not_ready", `${this.key}.${name} is not hydrated yet`);
    if (!this.inVariant(name))
      throw ChordError.create(
        "not_in_variant",
        `${this.key}: ${name} is not a state member of variant ${this.shape?.variant}`,
      );
    return this.members.get(name)?.value;
  }

  whenHydrated(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.ended) return Promise.reject(this.terminalError());
    return Effect.runPromise(
      Effect.callback<void>((resume) => {
        this.#hydrationWaiters.add({
          reject: (error) => resume(Effect.die(error)),
          resolve: () => resume(Effect.void),
        });
      }),
    );
  }

  #settleHydration(error?: unknown): void {
    const waiters = [...this.#hydrationWaiters];
    this.#hydrationWaiters.clear();
    for (const waiter of waiters) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }

  readable(name: string): boolean {
    return this.status !== "ended" && this.hydrated && this.inVariant(name);
  }

  terminalError(): unknown {
    return this.error ?? ChordError.create("released", `reference ${this.key} released`);
  }

  bound(channel: remoteTypesModule.RemoteChannel, id: number): void {
    this.hold = { channel, id };
    this.stateOn = this.wantsState;
  }

  shaped(shape: typesModule.Shape, listed: readonly string[]): void {
    if (this.ended) return;
    const previous = this.#pending;
    const missing = new Set<string>(listed);
    if (previous !== undefined) for (const name of previous.missing) missing.add(name);
    const wanted = new Set(stateMembers(this.contract, shape));
    for (const name of [...missing]) if (!wanted.has(name) || !this.stateOn) missing.delete(name);
    this.#pending = { missing, shape, values: previous?.values ?? new Map() };
    if (missing.size === 0) this.#apply();
  }

  state(name: string, frame: remoteTypesModule.StateIn): void {
    if (this.ended) return;
    if (frame.as === "error") {
      const error = fromWireError(frame.error!);
      if (!this.hydrated && this.stateOn) {
        this.gone(error);
        this.close();
      } else this.host.report(error);
      return;
    }
    const pending = this.#pending;
    if (frame.as === "ops") {
      const target = pending?.values.get(name) ?? this.members.get(name);
      if (target === undefined) return;
      const ops = target.decoder.decode(frame.ops ?? []);
      target.value = applyImmutable(target.value, ops);
      if (target === this.members.get(name))
        this.#deliver(name, { ops, type: "ops", value: target.value });
      return;
    }
    const fresh: remoteTypesModule.MemberState = { decoder: decoder(), value: frame.value };
    if (pending !== undefined && (pending.missing.has(name) || pending.values.has(name))) {
      pending.values.set(name, fresh);
      pending.missing.delete(name);
      if (pending.missing.size === 0) this.#apply();
      return;
    }
    if (!this.inVariant(name)) return;
    this.members.set(name, fresh);
    this.#deliver(name, { type: "reset", value: fresh.value });
  }

  gone(error: unknown): void {
    if (this.ended) return;
    this.status = "ended";
    this.error = error;
    this.hold = undefined;
    this.#pending = undefined;
    Deferred.doneUnsafe(this.#live, Effect.die(error));
    this.#settleHydration(error);
    for (const view of [...this.views]) view.end(error);
    this.#listeners.clear();
    this.host.forgetBinding(this);
  }

  detached(): void {
    if (this.ended) return;
    this.hold = undefined;
    this.#pending = undefined;
    if (this.status === "live") {
      this.status = "loading";
      this.#live = Deferred.makeUnsafe<void>();
    }
    for (const view of this.views) view.update();
  }

  close(): void {
    this.lingerTimer?.();
    this.lingerTimer = undefined;
    if (this.hold !== undefined) this.hold.channel.release(this.hold.id);
    this.hold = undefined;
    if (this.status !== "ended") {
      this.status = "ended";
      const error = ChordError.create("released", `reference ${this.key} released`);
      Deferred.doneUnsafe(this.#live, Effect.die(error));
      this.#settleHydration(error);
      for (const view of [...this.views]) view.end(error);
    }
    this.#pending = undefined;
    this.#listeners.clear();
    this.host.forgetBinding(this);
  }

  whenLive(): Effect.Effect<void> {
    return Deferred.await(this.#live);
  }

  #apply(): void {
    const pending = this.#pending;
    if (pending === undefined) return;
    this.#pending = undefined;
    this.shape = pending.shape;
    const wanted = new Set(stateMembers(this.contract, pending.shape));
    for (const name of [...this.members.keys()]) if (!wanted.has(name)) this.members.delete(name);
    for (const [name, state] of pending.values) if (wanted.has(name)) this.members.set(name, state);
    this.hydrated = this.stateOn && [...wanted].every((name) => this.members.has(name));
    if (this.hydrated) this.#settleHydration();
    this.status = "live";
    this.#applied = true;
    Deferred.doneUnsafe(this.#live, Effect.void);
    for (const view of this.views) view.update();
    for (const [name, state] of pending.values) {
      if (wanted.has(name)) this.#deliver(name, { type: "reset", value: state.value });
    }
    for (const view of [...this.views]) view.shapeChanged();
  }

  #deliver(name: string, event: typesModule.StateEvent<unknown>): void {
    const readables = this.#listeners.get(name);
    if (readables === undefined) return;
    for (const readable of [...readables]) readable.deliver(event);
  }
}
