import { dual } from "effect/Function";

import type { AcceptOptions, LinkOptions } from "./connection.ts";
import type {
  AnyContract,
  InputOf,
  LocalContract,
  LocalDef,
  Ref,
  RemoteContract,
  RemoteDef,
} from "./contract.ts";
import type { Link } from "./link.ts";
import type { Registry, RegistryTable, RegistryView } from "./registry.ts";
import type { ReloadOptions, ReloadReport } from "./reload-candidate.ts";
import type { Factory, ServeOptions, ServeOptionsFor, Service } from "./service.ts";
import type { Ctx, GetOptions } from "./types.ts";

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

export type AnyServe = (
  type: AnyContract,
  factory: Factory<AnyContract>,
  options?: ServeOptions,
) => void;

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

interface FacetUses {
  readonly uses?: readonly AnyContract[];
}

export const defineFacet: {
  (options?: FacetUses): <P = unknown>(setup: (api: FacetApi<P>) => void) => FacetDefinition<P>;
  <P = unknown>(setup: (api: FacetApi<P>) => void, options?: FacetUses): FacetDefinition<P>;
} = dual(
  (args) => typeof args[0] === "function",
  <P = unknown>(
    setup: (api: FacetApi<P>) => void,
    options: FacetUses = {},
  ): FacetDefinition<P> => ({
    setup,
    uses: options.uses,
  }),
);

export type FacetLoader = (modules: readonly (string | URL)[]) => Promise<Facet[]>;

export type PluginRef<P = unknown> = Facet<P> | string | URL;

export const isFacet = (ref: PluginRef): ref is Facet =>
  typeof ref === "object" && !(ref instanceof URL);

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
