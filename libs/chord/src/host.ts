import { ChildReloads, reconcileChild, runClusterReload } from "./cluster.ts";
import { type AcceptOptions, Connection, type LinkOptions, type RelayRef } from "./connection.ts";
import {
  type AnyContract,
  bind,
  contractFromDescription,
  type InputOf,
  type LocalContract,
  type LocalDef,
  placedOn,
  placementText,
  type Ref,
  type RemoteContract,
  type RemoteDef,
  resolveHost,
} from "./contract.ts";
import { ChordError, invalid, runAll } from "./errors.ts";
import type { Link } from "./link.ts";
import {
  awaitReady,
  CtxImpl,
  type Decls,
  type Factory,
  type HostCore,
  hostLifetime,
  makeService,
  ObjectImpl,
  type RefCore,
  RefImpl,
  type RefOwner,
  type ServeOptions,
  type ServeOptionsFor,
  type Service,
} from "./object.ts";
import { enqueue } from "./publish.ts";
import type { Registry, RegistryTable, RegistryView } from "./registry.ts";
import { type ReloadOptions, type ReloadReport, runReload } from "./reload.ts";
import { RemoteBinding, RemoteRef } from "./remote.ts";
import { canonicalIdentity, canonicalJson, deepEqual, normalize } from "./schema.ts";
import type { Ctx, GetOptions } from "./types.ts";
import type { Frame } from "./wire.ts";

export interface Serve<P = unknown> {
  <D extends RemoteDef>(
    type: RemoteContract<D>,
    factory: Factory<RemoteContract<D>, P>,
    options?: ServeOptionsFor<RemoteContract<D>>,
  ): void;
  <D extends LocalDef>(
    type: LocalContract<D>,
    factory: Factory<LocalContract<D>, P>,
    options?: ServeOptionsFor<LocalContract<D>>,
  ): void;
}

type AnyServe = (type: AnyContract, factory: Factory<AnyContract>, options?: ServeOptions) => void;

export interface FacetApi<P = unknown> {
  readonly serve: Serve<P>;
  readonly name: string;
  root<T>(fn: (ctx: Ctx<P>) => T | Promise<T>, options?: RootOptions<P>): Promise<T>;
  registry<V>(registry: Registry<V>): RegistryView<V>;
  readonly signal: AbortSignal;
}

export interface FacetDefinition<P = unknown> {
  readonly uses?: readonly AnyContract[] | undefined;
  setup(api: FacetApi<P>): void;
}

export interface Facet<P = unknown> extends FacetDefinition<P> {
  readonly name: string;
}

export const defineFacet = <P = unknown>(
  setup: (api: FacetApi<P>) => void,
  options: { readonly uses?: readonly AnyContract[] } = {},
): FacetDefinition<P> => ({ setup, uses: options.uses });

export type FacetLoader = (modules: readonly (string | URL)[]) => Promise<Facet[]>;

export type PluginRef<P = unknown> = Facet<P> | string | URL;

const isFacet = (ref: PluginRef): ref is Facet => typeof ref === "object" && !(ref instanceof URL);

export interface HostOptions<P = unknown> {
  readonly name?: string;
  readonly self: NoInfer<P>;
  readonly principalKey?: (principal: P) => string;
  readonly dev?: boolean;
  readonly onError?: (error: unknown) => void;
  readonly taskStopDeadline?: number;
  readonly readyTimeout?: number;
  readonly linger?: { readonly types?: Readonly<Record<string, number>>; readonly cap?: number };
  readonly loader?: FacetLoader;
  readonly kind?: "host" | "client";
  readonly upstream?: { readonly link: Link } & ConnectOptions<P>;
}

export interface ConnectOptions<P = unknown> extends LinkOptions {
  readonly principal: P;
}

export interface Route<P = unknown> {
  authorize(principal: P, hostName: string): boolean | Promise<boolean>;
  resolve(hostName: string): Promise<Link>;
  readonly principal: (hostName: string) => P;
}

export type PrincipalPattern<P> = P extends object
  ? { readonly [K in keyof P]?: P[K] }
  : Readonly<Record<string, unknown>>;

export type PrincipalMatch<P = unknown> = ((principal: P) => boolean) | PrincipalPattern<P>;

export interface RootOptions<P = unknown> {
  readonly principal?: P;
  readonly signal?: AbortSignal | undefined;
  readonly codeVersion?: number;
}

export interface LoadOptions {
  readonly awaitHostObjects?: boolean;
}

export interface Host<P = unknown> {
  readonly name: string;
  readonly codeVersion: number;
  readonly previousCodeVersion: number | undefined;
  readonly serve: Serve<P>;
  install(facet: Facet<P>, options?: LoadOptions): Promise<void>;
  load(plugins: readonly PluginRef<P>[], options?: LoadOptions): Promise<void>;
  ready(): Promise<void>;
  get<C extends AnyContract>(
    type: C,
    input: InputOf<C>,
    options?: GetOptions<P> & { readonly signal?: AbortSignal },
  ): Promise<Ref<C>>;
  hold<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions<P>): Ref<C>;
  root<T>(fn: (ctx: Ctx<P>) => T | Promise<T>, options?: RootOptions<P>): Promise<T>;
  registry<V>(registry: Registry<V>): RegistryView<V>;
  invalidatePrincipal(match: PrincipalMatch<P>): Promise<void>;
  accept(link: Link, options: AcceptOptions<P>): void;
  connect(link: Link, options: ConnectOptions<P>): void;
  route(prefix: string, route: Route<P>): void;
  reload(plugins: readonly PluginRef<P>[], options?: ReloadOptions): Promise<ReloadReport>;
  close(): Promise<void>;
}

export interface CodeVersionState {
  readonly id: number;
  readonly services: Map<string, Service>;
  tables: ReadonlyMap<string, RegistryTable<unknown>>;
  readonly roots: Map<string, number>;
  readonly abort: AbortController;
}

const EMPTY_TABLE: RegistryTable<never> = new Map<string, never>();

export function createHost<P = unknown>(options: HostOptions<P>): Host<P> {
  return new HostImpl(options as HostOptions) as unknown as Host<P>;
}

export class HostImpl implements Host, HostCore {
  readonly name: string;
  readonly dev: boolean;
  readonly principal: unknown;
  inFactory = 0;
  failed: unknown;
  readonly objects = new Map<string, ObjectImpl>();
  readonly codeVersions = new Map<number, CodeVersionState>();
  readonly facets = new Map<string, Facet>();
  readonly hostObjects = new Map<string, RefCore>();
  readonly kind: "host" | "client";
  readonly connections = new Set<Connection>();
  upstream: Connection | undefined;
  readonly bindings = new Map<string, RemoteBinding>();
  readonly #lingering = new Map<string, RemoteBinding>();
  readonly #lingerTypes: Readonly<Record<string, number>>;
  readonly #lingerCap: number;
  #originSeq = 0;
  readonly #routes = new Map<string, Route>();
  readonly #childReloads = new ChildReloads(this);
  remoteModules: Record<string, string[]> = {};
  remoteRemoved: Record<string, string[]> = {};
  #retireAllowed = 0;
  readonly #foreign = new Map<string, Set<Connection>>();
  readonly #local = new Set<string>();
  readonly #incarnation = Math.random().toString(36).slice(2, 8);
  readonly #rootLinks = new Map<string, Set<Connection>>();
  current: CodeVersionState;
  previous: CodeVersionState | undefined;
  pending: CodeVersionState | undefined;
  gating: ReadonlySet<string> | undefined;
  reloading = false;
  readonly taskStopDeadline: number;
  readonly readyTimeout: number;
  readonly #principalKey: (principal: unknown) => string;
  readonly #selfKey: string;
  readonly #retirementWatchers = new Set<() => void>();
  readonly #deferredHellos = new Map<Connection, number>();
  readonly #reloadWaiters: (() => void)[] = [];
  readonly #facetRuns = new Map<string, AbortController>();
  readonly #onError: (error: unknown) => void;
  readonly #loader: FacetLoader | undefined;
  readonly #dying = new Map<string, ObjectImpl>();
  readonly #touches = new Map<string, Set<ObjectImpl>>();
  readonly #order = new Map<string, Map<string, number>>();
  readonly #subscribers = new Map<
    string,
    Set<(table: RegistryTable<unknown>, codeVersion: number) => void>
  >();
  #codeVersionSeq = 1;
  #rootSeq = 0;

  constructor(options: HostOptions) {
    this.name = options.name ?? "host";
    this.dev = options.dev ?? false;
    if (!("self" in options))
      throw new TypeError("createHost needs `self`: the principal of the host's own code");
    this.principal = options.self;
    this.#principalKey = options.principalKey ?? canonicalJson;
    this.#selfKey = this.#principalKey(options.self);
    this.#onError = options.onError ?? ((error) => console.error("chord:", error));
    this.#loader = options.loader;
    this.taskStopDeadline = options.taskStopDeadline ?? 5000;
    this.readyTimeout = options.readyTimeout ?? 60_000;
    this.#lingerTypes = options.linger?.types ?? {};
    this.#lingerCap = options.linger?.cap ?? 4;
    this.current = {
      id: this.#codeVersionSeq,
      services: new Map(),
      tables: new Map(),
      roots: new Map(),
      abort: new AbortController(),
    };
    this.codeVersions.set(this.current.id, this.current);
    this.kind = options.kind ?? "host";
    if (options.upstream !== undefined) this.connect(options.upstream.link, options.upstream);
  }

  isSelf(principal: unknown): boolean {
    return principal === this.principal || this.#principalKey(principal) === this.#selfKey;
  }

  get codeVersion(): number {
    return this.current.id;
  }

  get previousCodeVersion(): number | undefined {
    return this.previous?.id;
  }

  nextCodeVersionId(given?: number): number {
    if (given !== undefined && given <= this.current.id)
      throw new Error(`code version ${given} is not newer than ${this.current.id}`);
    this.#codeVersionSeq = given ?? this.#codeVersionSeq + 1;
    return this.#codeVersionSeq;
  }

  report(error: unknown): void {
    this.#onError(error);
  }

  readonly serve: Serve = ((type, factory, options = {}) => {
    if (this.reloading)
      throw new Error("host.serve during a reload; serve from a facet passed to reload()");
    this.serveInto(this.current.services, makeService(type, factory, options, ""));
    if (options.lifetime === "host") this.startHostObject(this.current.services.get(type.name)!);
  }) satisfies AnyServe as Serve;

  install(facet: Facet, options: LoadOptions = {}): Promise<void> {
    if (this.reloading) throw new Error("host.install during a reload");
    if (this.facets.has(facet.name))
      throw new Error(`facet ${facet.name} is already installed; use reload()`);
    const added: Service[] = [];
    const run = new AbortController();
    try {
      facet.setup(
        this.facetApi(
          ((type, factory, setupOptions = {}) => {
            const service = makeService(type, factory, setupOptions, facet.name);
            this.serveInto(this.current.services, service);
            added.push(service);
          }) satisfies AnyServe as Serve,
          run.signal,
        ),
      );
    } catch (error) {
      run.abort(error);
      throw error;
    }
    this.facets.set(facet.name, facet);
    this.facetRunChanged(facet.name, run);
    const refs = added.filter(hostLifetime).map((service) => this.startHostObject(service));
    return options.awaitHostObjects === false ? Promise.resolve() : this.#hostObjectsReady(refs);
  }

  async load(plugins: readonly PluginRef[], options: LoadOptions = {}): Promise<void> {
    const facets = await this.resolve(plugins);
    await Promise.all(facets.map((facet) => this.install(facet, options)));
  }

  ready(): Promise<void> {
    return this.#hostObjectsReady(this.hostObjects.values());
  }

  #hostObjectsReady(refs: Iterable<RefCore>): Promise<void> {
    const ready = Promise.all([...refs].map((ref) => ref.ready)).then(() => undefined);
    ready.catch(() => {});
    return ready;
  }

  async resolve(plugins: readonly PluginRef[]): Promise<Facet[]> {
    const modules = plugins.filter((ref): ref is string | URL => !isFacet(ref));
    if (modules.length > 0 && this.#loader === undefined) {
      throw new Error(
        "loading modules needs createHost({ loader }), e.g. nodeLoader from @msa/chord/node",
      );
    }
    const loaded =
      modules.length > 0 && this.#loader !== undefined ? await this.#loader(modules) : [];
    return plugins.map((ref) => (isFacet(ref) ? ref : loaded.shift()!));
  }

  facetApi(serve: Serve, signal: AbortSignal): FacetApi {
    return {
      serve,
      name: this.name,
      root: (fn, options) => this.root(fn, options),
      registry: (registry) => this.registry(registry),
      signal,
    };
  }

  facetRunChanged(name: string, run: AbortController | undefined): void {
    const replaced = this.#facetRuns.get(name);
    if (run === undefined) this.#facetRuns.delete(name);
    else this.#facetRuns.set(name, run);
    if (replaced !== run)
      replaced?.abort(new ChordError("gone", `facet ${name} was replaced or removed`));
  }

  serveInto(services: Map<string, Service>, service: Service): void {
    if (services.has(service.contract.name))
      throw new Error(`${service.contract.name} is already served`);
    const placement = service.contract.description.host;
    if (placement !== undefined && !placedOn(placement, this.name)) {
      throw new TypeError(
        `${service.contract.name} is declared for ${placementText(placement)}, but ${this.name} serves it`,
      );
    }
    services.set(service.contract.name, service);
  }

  startHostObject(service: Service): RefCore {
    const ref = this.acquire(service.contract, {}, undefined, "host");
    this.hostObjects.set(service.contract.name, ref);
    ref.ready.catch((error: unknown) => this.report(error));
    return ref;
  }

  currentCodeVersion(): number {
    return this.current.id;
  }

  hasCodeVersion(codeVersion: number): boolean {
    return this.codeVersions.has(codeVersion);
  }

  *retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, Service>]> {
    for (const [id, state] of this.codeVersions) yield [id, state.services];
    if (this.pending !== undefined) yield [this.pending.id, this.pending.services];
  }

  pendingCodeVersion(): number | undefined {
    return this.pending?.id;
  }

  service(typeName: string): Service | undefined {
    return this.current.services.get(typeName) ?? this.pending?.services.get(typeName);
  }

  addressOf(type: AnyContract, input: unknown, principal: unknown, candidate = false): string {
    const elsewhere = this.#elsewhere(type, input);
    if (elsewhere !== undefined) return this.#remoteKey(type, elsewhere.input, principal);
    const service = this.#bindingService(type.name, candidate);
    if (service === undefined) throw unknownType(type.name, this.name);
    return this.#locate(service, input, principal).address;
  }

  #elsewhere(
    type: AnyContract,
    input: unknown,
  ): { readonly at: string; readonly input: unknown } | undefined {
    const placement = type.description.host;
    if (type.scope !== "remote" || placement === undefined) return undefined;
    const normalized = normalize(type.input, input, `${type.name} input`);
    const at = resolveHost(type.name, placement, normalized);
    return at === this.name ? undefined : { at, input: normalized };
  }

  #locate(service: Service, input: unknown, principal: unknown) {
    const { name, input: schema } = service.contract;
    const normalized = normalize(schema, input, `${name} input`);
    const identity = canonicalIdentity(schema, normalized);
    if (hostLifetime(service)) {
      if (identity !== canonicalIdentity(schema, normalize(schema, {}, `${name} input`)))
        throw invalid("input", `${name} has lifetime "host": its one object has the empty input`);
      principal = this.principal;
    }
    return {
      address: `${name}\u0000${identity}\u0000${this.#principalPart(principal)}`,
      normalized,
      principal,
    };
  }

  #principalPart(principal: unknown): string {
    return this.isSelf(principal) ? "host" : `p:${this.#principalKey(principal)}`;
  }

  #remoteKey(type: AnyContract, normalized: unknown, principal: unknown): string {
    const identity = canonicalIdentity(type.input, normalized);
    return `@${type.name}\u0000${identity}\u0000${this.#principalPart(principal)}\u0000${type.fingerprint}`;
  }

  acquire(
    type: AnyContract,
    input: unknown,
    options: GetOptions | undefined,
    owner: RefOwner,
    from?: ObjectImpl,
    candidate = false,
  ): RefCore {
    const elsewhere = this.#elsewhere(type, input);
    if (elsewhere !== undefined)
      return this.#acquireRemote(type, elsewhere.at, elsewhere.input, options, owner);
    const service = this.#bindingService(type.name, candidate);
    if (service === undefined) throw unknownType(type.name, this.name);
    bind(service.contract, service.options.accepts, type);
    const { address, normalized, principal } = this.#locate(
      service,
      input,
      options?.principal ?? this.principal,
    );
    const placement = service.contract.description.host;
    if (placement !== undefined && resolveHost(type.name, placement, normalized) !== this.name) {
      throw invalid(
        "placement",
        `${type.name} with this input lives on ${resolveHost(type.name, placement, normalized)}, not ${this.name}`,
      );
    }
    let object = this.objects.get(address);
    if (from !== undefined && object !== undefined && (object === from || reaches(object, from))) {
      throw invalid("cycle", `${from.address} -> ${address} would create a ref cycle`);
    }
    if (object === undefined) {
      if (this.gating?.has(type.name) === true) {
        throw new ChordError("upgrade_conflict", `${type.name} is being upgraded; retry`, {
          reason: "gate",
        });
      }
      const dying = this.#dying.get(address);
      if (dying?.status === "disposed") this.#dying.delete(address);
      object = new ObjectImpl(this, {
        address,
        typeName: type.name,
        input: normalized,
        principal,
        hostLifetime: hostLifetime(service),
      });
      this.objects.set(address, object);
      object.start(dying?.status === "disposing" ? dying.dispose(false) : undefined);
    }
    const ref = new RefImpl(object, type, owner);
    object.addRef(ref);
    return ref;
  }

  forget(object: ObjectImpl): void {
    if (this.objects.get(object.address) === object) this.objects.delete(object.address);
    if (object.status === "disposing") this.#dying.set(object.address, object);
  }

  disposed(object: ObjectImpl): void {
    if (this.#dying.get(object.address) === object) this.#dying.delete(object.address);
  }

  touch(rootId: string, object: ObjectImpl): void {
    let touched = this.#touches.get(rootId);
    if (touched === undefined) {
      touched = new Set();
      this.#touches.set(rootId, touched);
    }
    touched.add(object);
  }

  async root<T>(fn: (ctx: Ctx) => T | Promise<T>, options: RootOptions = {}): Promise<T> {
    const rootId = `${this.name}#${this.#incarnation}:${++this.#rootSeq}`;
    this.#local.add(rootId);
    return this.joinRoot(rootId, options.codeVersion ?? this.current.id, fn, options);
  }

  async joinRoot<T>(
    rootId: string,
    codeVersionId: number,
    fn: (ctx: Ctx) => T | Promise<T>,
    options: {
      readonly principal?: unknown;
      readonly signal?: AbortSignal | undefined;
      readonly from?: Connection;
    } = {},
  ): Promise<T> {
    const codeVersion = this.codeVersions.get(codeVersionId);
    if (codeVersion === undefined) {
      this.#local.delete(rootId);
      throw new ChordError(
        "superseded",
        `code version ${codeVersionId} is not retained by ${this.name}`,
      );
    }
    if (options.from !== undefined && !this.#local.has(rootId)) {
      let links = this.#foreign.get(rootId);
      if (links === undefined) {
        links = new Set();
        this.#foreign.set(rootId, links);
      }
      links.add(options.from);
    }
    codeVersion.roots.set(rootId, (codeVersion.roots.get(rootId) ?? 0) + 1);
    const ctx = new CtxImpl(this, {
      signals:
        options.signal === undefined
          ? [codeVersion.abort.signal]
          : [options.signal, codeVersion.abort.signal],
      rootId,
      codeVersion: codeVersion.id,
      principal: options.principal ?? this.principal,
    });
    try {
      return await fn(ctx);
    } finally {
      ctx.close();
      const count = (codeVersion.roots.get(rootId) ?? 1) - 1;
      if (count > 0) codeVersion.roots.set(rootId, count);
      else {
        codeVersion.roots.delete(rootId);
        if (!this.#foreign.has(rootId)) this.endRoot(rootId);
        this.maybeRetire();
        this.#retirementChanged();
      }
    }
  }

  rootSent(rootId: string, connection: Connection): void {
    let links = this.#rootLinks.get(rootId);
    if (links === undefined) {
      links = new Set();
      this.#rootLinks.set(rootId, links);
    }
    links.add(connection);
  }

  endRoot(rootId: string): void {
    this.#local.delete(rootId);
    this.#foreign.delete(rootId);
    for (const object of this.#touches.get(rootId) ?? []) object.rootEnded(rootId);
    this.#touches.delete(rootId);
    for (const connection of this.#rootLinks.get(rootId) ?? [])
      connection.send({ t: "root_end", rootId });
    this.#rootLinks.delete(rootId);
  }

  foreignRootEnded(rootId: string, from: Connection): void {
    const links = this.#foreign.get(rootId);
    if (links === undefined || !links.delete(from) || links.size > 0) return;
    const running = [...this.codeVersions.values()].some((codeVersion) =>
      codeVersion.roots.has(rootId),
    );
    if (running) this.#foreign.delete(rootId);
    else this.endRoot(rootId);
  }

  maybeRetire(): void {
    if (this.retirable()) this.retire();
  }

  retirable(): boolean {
    const previous = this.previous;
    if (previous === undefined || previous.roots.size > 0) return false;
    return (
      this.kind === "client" || this.upstream === undefined || previous.id <= this.#retireAllowed
    );
  }

  allowRetire(codeVersion: number): void {
    this.#retireAllowed = Math.max(this.#retireAllowed, codeVersion);
    this.maybeRetire();
    this.#retirementChanged();
  }

  watchRetirement(watcher: () => void): () => void {
    this.#retirementWatchers.add(watcher);
    return () => this.#retirementWatchers.delete(watcher);
  }

  #retirementChanged(): void {
    for (const watcher of [...this.#retirementWatchers]) watcher();
  }

  announceRetired(connection: Connection): void {
    const retired = (this.previous ?? this.current).id - 1;
    if (retired > 0) connection.send({ t: "retire", codeVersion: retired });
  }

  retire(): void {
    const previous = this.previous;
    if (previous === undefined) return;
    this.previous = undefined;
    this.codeVersions.delete(previous.id);
    for (const object of [...this.objects.values()]) this.retireImplementation(object, previous.id);
    for (const connection of this.connections) {
      if (connection.role === "downstream" && connection.peer?.kind === "host")
        connection.send({ t: "retire", codeVersion: previous.id });
    }
    this.#retirementChanged();
  }

  retireImplementation(object: ObjectImpl, codeVersion: number): void {
    const installed = object.implementations.get(codeVersion);
    object.implementations.delete(codeVersion);
    if (installed === undefined || installed.decls === object.decls) return;
    const kept = object.allDecls();
    const keep = <T>(pick: (decls: Decls) => Iterable<T>): Set<T> =>
      new Set([...kept].flatMap((decls) => Array.from(pick(decls))));
    const refs = keep((decls) => decls.refs.values());
    const resources = keep((decls) => decls.resources.values());
    const derives = keep((decls) => decls.derives.values());
    for (const derived of installed.decls.derives.values())
      if (!derives.has(derived)) derived.detach();
    const closing = [...installed.decls.resources.values()]
      .filter((resource) => !resources.has(resource))
      .sort((a, b) => object.openOrder.indexOf(b) - object.openOrder.indexOf(a));
    const releasing = [...installed.decls.refs.values()].filter((ref) => !refs.has(ref));
    object.refreshSchemas();
    runAll(
      [
        ...closing.map((resource) => () => resource.close(object.openOrder)),
        ...releasing.map((ref) => () => ref.release()),
      ],
      `${object.address}: retiring code version ${codeVersion} failed`,
    ).catch((error: unknown) => this.report(error));
  }

  registry<V>(registry: Registry<V>): RegistryView<V> {
    const table = (ctx?: Ctx): RegistryTable<V> => {
      const codeVersion = ctx === undefined ? this.current : this.codeVersions.get(ctx.codeVersion);
      if (codeVersion === undefined)
        throw new ChordError("superseded", `code version ${ctx?.codeVersion} is retired`);
      return (codeVersion.tables.get(registry.name) ?? EMPTY_TABLE) as RegistryTable<V>;
    };
    return {
      table,
      get: (key, ctx) => table(ctx).get(key),
      subscribe: (listener) => {
        let set = this.#subscribers.get(registry.name);
        if (set === undefined) {
          set = new Set();
          this.#subscribers.set(registry.name, set);
        }
        const wrapped = listener as (table: RegistryTable<unknown>, codeVersion: number) => void;
        set.add(wrapped);
        wrapped(table(), this.current.id);
        return () => set.delete(wrapped);
      },
    };
  }

  buildTables(
    entries: Iterable<readonly [ObjectImpl, Decls]>,
  ): Map<string, RegistryTable<unknown>> {
    const byRegistry = new Map<string, Map<string, { value: unknown; object: ObjectImpl }>>();
    for (const [object, decls] of entries) {
      for (const { registry, key, value } of decls.registrations.values()) {
        let registryEntries = byRegistry.get(registry.name);
        if (registryEntries === undefined) {
          registryEntries = new Map();
          byRegistry.set(registry.name, registryEntries);
        }
        const existing = registryEntries.get(key);
        if (existing !== undefined && existing.object !== object && registry.conflict === "error") {
          throw invalid(
            "registry_conflict",
            `${registry.name}: ${key} registered by ${existing.object.address} and ${object.address}`,
          );
        }
        registryEntries.set(key, { value, object });
        let order = this.#order.get(registry.name);
        if (order === undefined) {
          order = new Map();
          this.#order.set(registry.name, order);
        }
        if (!order.has(key)) order.set(key, order.size);
      }
    }
    const tables = new Map<string, RegistryTable<unknown>>();
    for (const [name, tableEntries] of byRegistry) {
      const order = this.#order.get(name)!;
      const sorted = [...tableEntries].sort(([a], [b]) => order.get(a)! - order.get(b)!);
      tables.set(name, new Map(sorted.map(([key, entry]) => [key, entry.value])));
    }
    return tables;
  }

  #bindingService(typeName: string, candidate: boolean): Service | undefined {
    return (candidate ? this.pending?.services.get(typeName) : undefined) ?? this.service(typeName);
  }

  liveDecls(candidates = false): [ObjectImpl, Decls][] {
    return [...this.objects.values()]
      .filter((object) => object.status === "live" && (candidates || !object.deferredRuntime))
      .map((object) => [object, object.decls]);
  }

  checkRegistrations(object: ObjectImpl, decls: Decls): void {
    if (decls.registrations.size === 0) return;
    this.buildTables([...this.liveDecls().filter(([other]) => other !== object), [object, decls]]);
  }

  registriesChanged(including?: ObjectImpl): void {
    const entries = this.liveDecls().filter(([object]) => object !== including);
    if (including !== undefined) entries.push([including, including.decls]);
    this.installTables(this.current, this.buildTables(entries));
  }

  fail(error: unknown): void {
    this.failed ??= error;
    this.report(error);
  }

  installTables(
    codeVersion: CodeVersionState,
    tables: Map<string, RegistryTable<unknown>>,
    all = false,
  ): void {
    const before = codeVersion.tables;
    codeVersion.tables = tables;
    if (codeVersion !== this.current) return;
    for (const [name, listeners] of this.#subscribers) {
      const next = tables.get(name) ?? EMPTY_TABLE;
      if (!all && sameTable(before.get(name) ?? EMPTY_TABLE, next)) continue;
      const current = [...listeners];
      enqueue(() => {
        for (const listener of current) {
          try {
            listener(next, codeVersion.id);
          } catch (error) {
            this.report(error);
          }
        }
      });
    }
  }

  async get<C extends AnyContract>(
    type: C,
    input: InputOf<C>,
    options?: GetOptions & { readonly signal?: AbortSignal },
  ): Promise<Ref<C>> {
    const ref = this.acquire(type, input, options, "external");
    await awaitReady(ref, options?.signal === undefined ? [] : [options.signal], this.readyTimeout);
    return ref.proxy as Ref<C>;
  }

  hold<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Ref<C> {
    return this.acquire(type, input, options, "external").proxy as Ref<C>;
  }

  async invalidatePrincipal(match: PrincipalMatch): Promise<void> {
    const matches =
      typeof match === "function"
        ? match
        : (principal: unknown) => matchesPattern(match, principal);
    const reason = new ChordError("gone", "principal invalidated");
    for (const connection of [...this.connections]) {
      if (connection.role !== "downstream" || !matches(connection.principal)) continue;
      connection.revoke(connection.restamp?.(connection.principal));
    }
    if (typeof match !== "function") {
      for (const connection of this.connections) {
        if (connection.role === "downstream" && connection.peer.kind === "host") {
          connection.send({ t: "invalidate", pattern: match });
        }
      }
    }
    const matching = [...this.objects.values()].filter(
      (object) => !this.isSelf(object.principal) && matches(object.principal),
    );
    await disposeHoldersFirst(matching, reason, "invalidatePrincipal: disposal failed");
  }

  accept(link: Link, options: AcceptOptions): void {
    const kind = options.kind ?? "client";
    if (kind === "host" && options.name === undefined)
      throw new TypeError("accepting a host link needs its name");
    this.#addConnection(link, {
      ...options,
      role: "downstream",
      principal: options.principal,
      peer: { kind, name: kind === "host" ? options.name : undefined },
      ...(kind === "client" ? { originId: `${this.#incarnation}:${++this.#originSeq}` } : {}),
    });
  }

  connect(link: Link, options: ConnectOptions): void {
    if (!("principal" in options))
      throw new TypeError("connect needs `principal`: what the parent's own requests act as");
    if (this.upstream?.open === true) this.upstream.link.close("replaced");
    const connection = this.#addConnection(link, {
      ...options,
      role: "upstream",
      principal: options.principal,
      peer: { kind: "host", name: undefined },
    });
    this.upstream = connection;
    for (const binding of this.bindings.values())
      if (binding.hold === undefined && !binding.ended) connection.hold(binding, binding.applied);
  }

  #addConnection(link: Link, config: ConstructorParameters<typeof Connection>[2]): Connection {
    const connection = new Connection(this, link, config);
    if (connection.open) this.connections.add(connection);
    return connection;
  }

  route(prefix: string, route: Route): void {
    if (typeof route.principal !== "function")
      throw new TypeError(
        `route ${prefix} needs \`principal\`: what the routed hosts act as when they call back`,
      );
    this.#routes.set(prefix, route);
  }

  peerHello(connection: Connection, codeVersion: number): void {
    if (codeVersion > this.current.id) {
      this.report(
        new ChordError(
          "invalid",
          `${connection.name} runs code version ${codeVersion}, ahead of ${this.current.id}`,
        ),
      );
      connection.link.close("code version ahead of parent");
      return;
    }
    if (this.reloading) {
      connection.peerCodeVersion = codeVersion;
      if (codeVersion < this.current.id) connection.fencedCodeVersions.add(codeVersion);
      this.#deferredHellos.set(connection, codeVersion);
      return;
    }
    if (codeVersion === this.current.id) {
      connection.markSynced(codeVersion);
      this.announceRetired(connection);
      return;
    }
    connection.peerCodeVersion = codeVersion;
    connection.fencedCodeVersions.add(codeVersion);
    reconcileChild(this, connection).catch((error: unknown) => {
      this.report(error);
      connection.link.close("reconciliation failed");
    });
  }

  reloadEnded(): void {
    this.reloading = false;
    const deferred = [...this.#deferredHellos];
    this.#deferredHellos.clear();
    for (const [connection, codeVersion] of deferred)
      if (connection.open) this.peerHello(connection, codeVersion);
    for (const resolve of this.#reloadWaiters.splice(0)) resolve();
    this.maybeRetire();
  }

  whenReloadEnded(): Promise<void> {
    if (!this.reloading) return Promise.resolve();
    return new Promise((resolve) => this.#reloadWaiters.push(resolve));
  }

  connectionClosed(connection: Connection): void {
    this.connections.delete(connection);
    this.#deferredHellos.delete(connection);
    for (const [rootId, links] of [...this.#foreign])
      if (links.has(connection)) this.foreignRootEnded(rootId, connection);
    for (const links of this.#rootLinks.values()) links.delete(connection);
    if (this.upstream === connection) {
      this.upstream = undefined;
      this.#childReloads.parentLost();
    }
  }

  bindingIdle(binding: RemoteBinding): void {
    const ms = Object.hasOwn(this.#lingerTypes, binding.contract.name)
      ? this.#lingerTypes[binding.contract.name]!
      : 0;
    if (ms <= 0 || binding.ended || !binding.applied || this.#lingerCap <= 0) {
      binding.close();
      return;
    }
    binding.lingerTimer = setTimeout(() => binding.close(), ms);
    (binding.lingerTimer as { unref?: () => void }).unref?.();
    this.#lingering.set(binding.key, binding);
    for (const oldest of this.#lingering.values()) {
      if (this.#lingering.size <= this.#lingerCap) break;
      oldest.close();
    }
  }

  forgetBinding(binding: RemoteBinding): void {
    if (this.bindings.get(binding.key) === binding) this.bindings.delete(binding.key);
    if (this.#lingering.get(binding.key) === binding) this.#lingering.delete(binding.key);
  }

  #childNamed(name: string): Connection | undefined {
    return [...this.connections].find(
      (connection) =>
        connection.open &&
        connection.role === "downstream" &&
        connection.peer.kind === "host" &&
        connection.peer.name === name,
    );
  }

  #acquireRemote(
    type: AnyContract,
    at: string,
    input: unknown,
    options: GetOptions | undefined,
    owner: RefOwner,
  ): RefCore {
    const principal =
      options?.principal === undefined || this.isSelf(options.principal)
        ? undefined
        : options.principal;
    const key = this.#remoteKey(type, input, principal ?? this.principal);
    let binding = this.bindings.get(key);
    const fresh = binding === undefined || binding.ended;
    if (binding === undefined || binding.ended) {
      binding = new RemoteBinding(this, { key, contract: type, at, input, principal });
      this.bindings.set(key, binding);
    }
    const ref = new RemoteRef(binding, owner, options?.state !== false);
    this.#lingering.delete(key);
    binding.addView(ref);
    if (fresh) this.#hold(binding);
    return ref;
  }

  #hold(binding: RemoteBinding): void {
    const bindWhenSynced = (connection: Promise<Connection>): void => {
      connection.then(
        (target) => {
          if (!binding.ended && binding.hold === undefined) target.hold(binding, false);
          return undefined;
        },
        (error: unknown) => binding.gone(error),
      );
    };
    const direct = this.#childNamed(binding.at);
    if (this.upstream !== undefined) {
      this.upstream.hold(binding, false);
      return;
    }
    if (direct !== undefined) {
      bindWhenSynced(direct.whenSynced().then(() => direct));
      return;
    }
    const route = this.#routeFor(binding.at);
    if (route === undefined)
      binding.gone(new ChordError("unavailable", `no route to ${binding.at}`));
    else bindWhenSynced(this.#resolve(route, binding.at, binding.principal ?? this.principal));
  }

  #routeFor(hostName: string): Route | undefined {
    let best: [string, Route] | undefined;
    for (const entry of this.#routes) {
      if (hostName.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length))
        best = entry;
    }
    return best?.[1];
  }

  async #resolve(
    route: Route,
    hostName: string,
    principal: unknown,
    still: () => boolean = () => true,
  ): Promise<Connection> {
    const refuse = (): ChordError =>
      new ChordError("forbidden", `${hostName} refused for this principal`);
    const revoked = (): ChordError =>
      new ChordError("gone", "principal invalidated while resolving");
    if (!(await route.authorize(principal, hostName))) throw refuse();
    if (!still()) throw revoked();
    const link = await route.resolve(hostName);
    if (!still()) throw revoked();
    if (!(await route.authorize(principal, hostName))) throw refuse();
    if (!still()) throw revoked();
    let connection = [...this.connections].find((candidate) => candidate.link === link);
    connection ??= this.#addConnection(link, {
      role: "downstream",
      principal: route.principal(hostName),
      peer: { kind: "host", name: hostName },
    });
    await connection.whenSynced();
    if (!still()) throw revoked();
    return connection;
  }

  async relay(relay: RelayRef): Promise<void> {
    const at = relay.frame.at;
    const placement = contractFromDescription(relay.frame.token).description.host;
    if (
      placement === undefined ||
      resolveHost(relay.frame.token.name, placement, relay.frame.input) !== at
    )
      throw invalid(
        "placement",
        `${relay.frame.token.name} with this input does not live on ${at}`,
      );
    const route = this.#routeFor(at);
    if (route === undefined) {
      throw this.#childNamed(at) === undefined
        ? new ChordError("unavailable", `no route to ${at}`)
        : new ChordError("forbidden", `no route authorizes ${at}`);
    }
    const down = await this.#resolve(route, at, relay.principal, () => relay.current);
    if (!relay.current) return;
    relay.open(down);
  }

  reload(plugins: readonly PluginRef[], options: ReloadOptions = {}): Promise<ReloadReport> {
    if (this.kind !== "client" && this.upstream !== undefined) {
      return Promise.reject(
        new ChordError("unavailable", "reloads are coordinated by the server", {
          reason: "not_coordinator",
        }),
      );
    }
    const children = [...this.connections].some(
      (connection) => connection.role === "downstream" && connection.peer.kind === "host",
    );
    return children || options.remote !== undefined || options.remoteRemove !== undefined
      ? runClusterReload(this, plugins, options)
      : runReload(this, plugins, options);
  }

  onReloadFrame(
    connection: Connection,
    frame: Extract<Frame, { t: "prepare" | "commit" | "abort" }>,
  ): void {
    this.#childReloads.handle(connection, frame);
  }

  rememberRemoteModules(
    remote: Readonly<Record<string, readonly string[]>> | undefined,
    remove: Readonly<Record<string, readonly string[]>> | undefined,
  ): void {
    for (const prefix of new Set([...Object.keys(remote ?? {}), ...Object.keys(remove ?? {})])) {
      const modules = remote?.[prefix] ?? [];
      const removed = remove?.[prefix] ?? [];
      this.remoteModules[prefix] = [
        ...new Set([...(this.remoteModules[prefix] ?? []), ...modules]),
      ].filter((module) => !removed.includes(module));
      this.remoteRemoved[prefix] = [
        ...new Set([...(this.remoteRemoved[prefix] ?? []), ...removed]),
      ].filter((module) => !modules.includes(module));
    }
  }

  peekNextCodeVersion(): number {
    return this.#codeVersionSeq + 1;
  }

  async close(): Promise<void> {
    for (const binding of [...this.#lingering.values()]) binding.close();
    this.hostObjects.clear();
    for (const name of [...this.#facetRuns.keys()]) this.facetRunChanged(name, undefined);
    const reason = new ChordError("gone", `host ${this.name} closed`);
    try {
      await disposeHoldersFirst([...this.objects.values()], reason, "host close: disposal failed");
    } finally {
      for (const connection of [...this.connections]) connection.link.close("host closed");
    }
  }
}

async function disposeHoldersFirst(
  objects: readonly ObjectImpl[],
  reason: unknown,
  message: string,
): Promise<void> {
  const remaining = new Set(objects);
  const held = (object: ObjectImpl): Set<ObjectImpl> => {
    const result = new Set<ObjectImpl>();
    for (const decls of object.allDecls()) {
      for (const ref of decls.refs.values()) if (ref.object !== undefined) result.add(ref.object);
    }
    return result;
  };
  const refs = new Map(objects.map((object) => [object, held(object)] as const));
  const errors: unknown[] = [];
  while (remaining.size > 0) {
    const heldByRemaining = new Set<ObjectImpl>();
    for (const object of remaining)
      for (const target of refs.get(object) ?? []) heldByRemaining.add(target);
    let wave = [...remaining].filter((object) => !heldByRemaining.has(object));
    if (wave.length === 0) wave = [...remaining];
    for (const object of wave) remaining.delete(object);
    const results = await Promise.allSettled(wave.map((object) => object.dispose(true, reason)));
    for (const result of results) if (result.status === "rejected") errors.push(result.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

function sameTable(a: RegistryTable<unknown>, b: RegistryTable<unknown>): boolean {
  if (a.size !== b.size) return false;
  const keys = [...a.keys()];
  return [...b].every(([key, value], index) => keys[index] === key && a.get(key) === value);
}

const matchesPattern = (pattern: Readonly<Record<string, unknown>>, principal: unknown): boolean =>
  principal !== null &&
  typeof principal === "object" &&
  Object.entries(pattern).every(([key, value]) =>
    deepEqual((principal as Record<string, unknown>)[key], value),
  );

const unknownType = (type: string, host: string): ChordError =>
  new ChordError("unavailable", `${type} is not served by ${host}`, { reason: "unknown_type" });

function reaches(from: ObjectImpl, to: ObjectImpl): boolean {
  const seen = new Set<ObjectImpl>();
  const stack = [from];
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object === to) return true;
    if (seen.has(object)) continue;
    seen.add(object);
    for (const decls of object.allDecls()) {
      for (const ref of decls.refs.values()) if (ref.object !== undefined) stack.push(ref.object);
    }
  }
  return false;
}
