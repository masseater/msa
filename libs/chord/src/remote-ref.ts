import { Deferred, Effect } from "effect";
import { Value } from "typebox/value";

import { type AnyContract, takesNoArgs } from "./contract.ts";
import {
  notifyStatus,
  REF_BASE,
  type RefCore,
  type RefOwner,
  refsByProxy,
  type StatusListener,
} from "./core.ts";
import { CtxImpl } from "./ctx.ts";
import { ChordError, invalid } from "./errors.ts";
import type { RemoteBinding } from "./remote.ts";
import { raceSignal } from "./signal.ts";
import type { Ctx, RefStatus, Shape } from "./types.ts";
import { ViewReadable } from "./view-readable.ts";

export { RemoteBinding } from "./remote.ts";

const noop = (): void => {};

export class RemoteRef implements RefCore {
  readonly object = undefined;
  readonly binding: RemoteBinding;
  readonly owner: RefOwner;
  readonly wantsState: boolean;
  readonly proxy: object;
  readonly ready: Promise<void>;
  status: RefStatus = "loading";
  error: unknown;
  readonly shapeListeners = new Set<(shape: Shape) => void>();
  readonly #statusListeners = new Set<StatusListener>();
  readonly #readables = new Map<string, ViewReadable>();
  readonly #callers = new Map<string, (...given: unknown[]) => Promise<unknown>>();
  #settleReady: Deferred.Deferred<void> | undefined;

  constructor(binding: RemoteBinding, owner: RefOwner, wantsState: boolean) {
    this.binding = binding;
    this.owner = owner;
    this.wantsState = wantsState;
    const ready = Deferred.makeUnsafe<void>();
    this.ready = Effect.runPromise(Deferred.await(ready));
    this.ready.catch(noop);
    this.#settleReady = ready;
    this.proxy = new Proxy(this, {
      get: (target, property) => {
        if (REF_BASE.has(property)) {
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        if (typeof property !== "string" || property === "then") return undefined;
        return target.member(property);
      },
    });
    refsByProxy.set(this.proxy, this);
  }

  get contract(): AnyContract {
    return this.binding.contract;
  }

  get address(): string {
    return this.binding.key;
  }

  get ended(): boolean {
    return this.status === "released" || this.status === "gone";
  }

  get variant(): string | undefined {
    return this.binding.shape?.variant;
  }

  get shape(): Shape | undefined {
    return this.binding.shape;
  }

  onShape(listener: (shape: Shape) => void): () => void {
    this.shapeListeners.add(listener);
    return () => this.shapeListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  terminalError(): unknown {
    return this.status === "gone"
      ? this.error
      : new ChordError("released", `reference ${this.address} released`);
  }

  release(): void {
    if (this.ended) return;
    this.status = "released";
    this.#notify();
    this.#settle(Effect.die(new ChordError("released", `reference ${this.address} released`)));
    this.#settleReady = undefined;
    for (const readable of this.#readables.values()) readable.stop();
    this.binding.removeView(this);
  }

  update(): void {
    if (this.ended) return;
    const binding = this.binding;
    const live =
      binding.status === "live" &&
      binding.hold !== undefined &&
      (!this.wantsState || binding.hydrated);
    const next: RefStatus = live ? "live" : "loading";
    if (next === this.status) return;
    this.status = next;
    this.#notify();
    if (live) {
      this.#settle(Effect.void);
    }
  }

  end(error: unknown): void {
    if (this.ended) return;
    const released = error instanceof ChordError && error.code === "released";
    this.status = released ? "released" : "gone";
    if (!released) this.error = error;
    this.#notify();
    this.#settle(Effect.die(error));
    for (const readable of this.#readables.values()) readable.stop();
  }

  shapeChanged(): void {
    const shape = this.binding.shape;
    if (shape === undefined || this.ended) return;
    for (const listener of [...this.shapeListeners]) {
      try {
        listener(shape);
      } catch (error) {
        this.binding.host.report(error);
      }
    }
  }

  #notify(): void {
    notifyStatus(this.#statusListeners, this.status, this.error, (error) =>
      this.binding.host.report(error),
    );
  }

  member(name: string): unknown {
    const description = Object.values(this.contract.description.variants)
      .map((members) => members[name])
      .find((member) => member !== undefined);
    if (description?.kind === "method") return this.#caller(name);
    if (description?.kind === "state") {
      let readable = this.#readables.get(name);
      if (readable === undefined) {
        readable = new ViewReadable(this, name);
        this.#readables.set(name, readable);
      }
      return readable;
    }
    return undefined;
  }

  #caller(name: string): (...given: unknown[]) => Promise<unknown> {
    let caller = this.#callers.get(name);
    if (caller === undefined) {
      const noArgs = takesNoArgs(this.contract, name);
      caller = (...given) => {
        const [args, ctx] = (noArgs ? [undefined, given[0]] : given) as [unknown, Ctx | undefined];
        const host = this.binding.host;
        if (host.inFactory > 0)
          throw new ChordError("not_ready", `${this.address}.${name} called inside a factory`);
        if (ctx !== undefined && !(ctx instanceof CtxImpl)) {
          return Promise.reject(invalid("foreign_ctx", "ctx must come from a Chord host"));
        }
        try {
          ctx?.check(host);
        } catch (error) {
          return Promise.reject(error);
        }
        if (ctx === undefined || ctx.holder) {
          return host.root((root) => this.#call(name, args, root), { signal: ctx?.signal });
        }
        return this.#call(name, args, ctx);
      };
      this.#callers.set(name, caller);
    }
    return caller;
  }

  #settle(outcome: Effect.Effect<void>): void {
    if (this.#settleReady !== undefined) Deferred.doneUnsafe(this.#settleReady, outcome);
    this.#settleReady = undefined;
  }

  #call(name: string, args: unknown, ctx: Ctx): Promise<unknown> {
    if (this.ended) return Promise.reject(this.terminalError());
    return Effect.runPromise(this.#callLoop(name, args, ctx));
  }

  #callLoop(name: string, args: unknown, ctx: Ctx): Effect.Effect<unknown> {
    const binding = this.binding;
    return Effect.gen(function* () {
      for (;;) {
        if (binding.ended) throw binding.terminalError();
        if (binding.status !== "live" || binding.hold === undefined)
          yield* raceSignal(binding.whenLive(), ctx.signal);
        const hold = binding.hold;
        if (hold === undefined || binding.status !== "live") continue;
        const variant = binding.shape?.variant;
        const description =
          variant === undefined
            ? undefined
            : binding.contract.description.variants[variant]?.[name];
        if (description?.kind !== "method") {
          throw new ChordError(
            "not_in_variant",
            `${binding.key}: ${name} is not a method of variant ${variant}`,
          );
        }
        const sent =
          description.args === undefined
            ? undefined
            : Value.Clean(description.args, Value.Clone(args));
        return yield* hold.channel.call({
          hold: hold.id,
          member: name,
          args: sent,
          root: { rootId: ctx.rootId, codeVersion: ctx.codeVersion },
          signal: ctx.signal,
        });
      }
    });
  }
}
