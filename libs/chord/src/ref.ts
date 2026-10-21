import type contractTypes from "./contract.types.ts";
import type coreTypes from "./core.types.ts";
import type ctxTypes from "./ctx.types.ts";
import type memberReadableTypes from "./member-readable.types.ts";
import type objectTypes from "./object.types.ts";
import publish from "./publish.ts";
import refKit from "./ref-kit.ts";
import serviceModule from "./service.ts";
import type serviceTypes from "./service.types.ts";
import type typesModule from "./types.types.ts";

const {
  contract: contractModule,
  core,
  CtxImpl,
  errors: errorsModule,
  ExposedImpl,
  MemberReadable,
} = refKit;

const { ChordError, invalid } = errorsModule;
const { REF_BASE, notifyStatus, refsByProxy } = core;
const { isStateLike, variantOf } = serviceModule;
const { enqueue } = publish;
const { bind, takesNoArgs } = contractModule;
const noop = (): void => {};

export default class RefImpl {
  readonly object: objectTypes.ObjectImpl;
  readonly contract: contractTypes.AnyContract;
  readonly owner: coreTypes.RefOwner;
  readonly address: string;
  readonly proxy: object;
  readonly ready: Promise<void>;
  status: typesModule.RefStatus;
  error: unknown;
  readonly shapeListeners = new Set<(shape: typesModule.Shape) => void>();
  readonly goneListeners = new Set<(error: unknown) => void>();
  readonly readables = new Map<string, memberReadableTypes.MemberReadable>();
  readonly bindings = new WeakMap<serviceTypes.Service, contractTypes.Adapter | undefined>();
  readonly views = new WeakMap<Record<string, unknown>, Record<string, unknown>>();
  readonly callers = new Map<string, (...given: unknown[]) => Promise<unknown>>();

  constructor(
    object: objectTypes.ObjectImpl,
    contract: contractTypes.AnyContract,
    owner: coreTypes.RefOwner,
  ) {
    this.object = object;
    this.contract = contract;
    this.owner = owner;
    this.address = object.address;
    this.status = object.status === "live" ? "live" : "loading";
    this.ready = object.ready.then(() => {
      if (this.status === "gone") throw this.error;
      if (this.status === "released")
        throw new ChordError("released", `reference ${this.address} released`);
      return undefined;
    });
    this.ready.catch(noop);
    this.proxy = new Proxy(this, {
      get: (target, property) => {
        if (REF_BASE.has(property)) {
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        if (typeof property !== "string" || property === "then") return undefined;
        return target.member(property);
      },
      has: (target, property) =>
        REF_BASE.has(property) || target.member(String(property)) !== undefined,
    });
    refsByProxy.set(this.proxy, this);
  }

  get variant(): string | undefined {
    const view = this.currentView();
    return view === undefined ? undefined : variantOf(view);
  }

  get shape(): typesModule.Shape | undefined {
    const installed = this.status === "live" ? this.object.currentInstalled() : undefined;
    const view = installed === undefined ? undefined : this.#safeView(installed);
    if (installed === undefined || view === undefined) return undefined;
    return {
      contract: installed.service.contract.fingerprint,
      members: Object.keys(view).filter((key) => key !== "variant"),
      variant: variantOf(view),
    };
  }

  onShape(listener: (shape: typesModule.Shape) => void): () => void {
    this.shapeListeners.add(listener);
    return () => this.shapeListeners.delete(listener);
  }

  onStatus(listener: coreTypes.StatusListener): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  readonly #statusListeners = new Set<coreTypes.StatusListener>();

  #statusChanged(): void {
    notifyStatus(this.#statusListeners, this.status, this.error, (error) =>
      this.object.host.report(error),
    );
  }

  release(): void {
    if (this.status === "released" || this.status === "gone") return;
    this.status = "released";
    this.#stopReadables();
    this.#statusChanged();
    this.object.release(this);
  }

  live(): void {
    if (this.status !== "loading") return;
    this.status = "live";
    this.#statusChanged();
    this.shapeChanged();
  }

  gone(error: unknown): void {
    if (this.status === "released" || this.status === "gone") return;
    this.status = "gone";
    this.error = error;
    this.#stopReadables();
    this.#statusChanged();
    for (const listener of [...this.goneListeners]) listener(error);
  }

  shapeChanged(): void {
    for (const readable of this.readables.values()) readable.bind();
    const shape = this.shape;
    if (shape === undefined) return;
    const listeners = [...this.shapeListeners];
    enqueue(() => {
      for (const listener of listeners) {
        try {
          listener(shape);
        } catch (error) {
          this.object.host.report(error);
        }
      }
    });
  }

  terminalError(): unknown {
    return this.status === "gone"
      ? this.error
      : new ChordError("released", `reference ${this.address} released`);
  }

  viewOf(installed: coreTypes.Installed): Record<string, unknown> {
    let adapter = this.bindings.get(installed.service);
    if (!this.bindings.has(installed.service)) {
      adapter = bind(installed.service.contract, installed.service.options.accepts, this.contract);
      this.bindings.set(installed.service, adapter);
    }
    if (adapter === undefined) return installed.implementation;
    let view = this.views.get(installed.implementation);
    if (view === undefined) {
      view = adapter(installed.implementation);
      this.views.set(installed.implementation, view);
    }
    return view;
  }

  currentView(): Record<string, unknown> | undefined {
    if (this.status !== "live") return undefined;
    const installed = this.object.currentInstalled();
    return installed === undefined ? undefined : this.#safeView(installed);
  }

  #safeView(installed: coreTypes.Installed): Record<string, unknown> | undefined {
    try {
      return this.viewOf(installed);
    } catch (error) {
      this.object.host.report(error);
      return undefined;
    }
  }

  describe(
    variant: string | undefined,
    member: string,
  ): contractTypes.MemberDescription | undefined {
    const variants = this.contract.description.variants;
    if (variant !== undefined) return variants[variant]?.[member];
    for (const members of Object.values(variants))
      if (members[member] !== undefined) return members[member];
    return undefined;
  }

  inVariant(view: Record<string, unknown>, name: string): boolean {
    return this.contract.scope !== "remote" || this.describe(variantOf(view), name) !== undefined;
  }

  member(name: string): unknown {
    const declared = this.describe(undefined, name);
    const view = this.currentView();
    const value = view?.[name];
    if (declared?.kind === "method" || (declared === undefined && typeof value === "function")) {
      return this.caller(name);
    }
    if (declared?.kind === "state" || (declared === undefined && isStateLike(value))) {
      let readable = this.readables.get(name);
      if (readable === undefined) {
        readable = new MemberReadable(this, name);
        this.readables.set(name, readable);
      }
      return readable;
    }
    if (view === undefined || !this.inVariant(view, name)) return undefined;
    return value instanceof ExposedImpl ? value.resource.value : value;
  }

  caller(name: string): (...given: unknown[]) => Promise<unknown> {
    let caller = this.callers.get(name);
    if (caller === undefined) {
      const noArgs = takesNoArgs(this.contract, name);
      caller = (...given) => {
        const [args, ctx] = (noArgs ? [undefined, given[0]] : given) as [
          unknown,
          typesModule.Ctx | undefined,
        ];
        if (this.object.host.inFactory > 0) {
          throw new ChordError("not_ready", `${this.address}.${name} called inside a factory`);
        }
        if (ctx !== undefined && !(ctx instanceof CtxImpl)) {
          return Promise.reject(invalid("foreign_ctx", "ctx must come from a Chord host"));
        }
        if (ctx === undefined || ctx.holder) {
          try {
            ctx?.check(this.object.host);
          } catch (error) {
            return Promise.reject(error);
          }
          return this.object.host.root(
            (root) => this.object.calls.run(this, name, args, root as ctxTypes.CtxImpl),
            {
              signal: ctx?.signal,
            },
          );
        }
        return this.object.calls.run(this, name, args, ctx);
      };
      this.callers.set(name, caller);
    }
    return caller;
  }

  #stopReadables(): void {
    for (const readable of this.readables.values()) readable.stop();
  }
}
