import type connectionTypes from "./connection.types.ts";
import type contractTypes from "./contract.types.ts";
import type linkTypes from "./link.types.ts";
import type registryTypes from "./registry.types.ts";
import type reloadCandidateTypes from "./reload-candidate.types.ts";
import type serviceTypes from "./service.types.ts";
import type typesModule from "./types.types.ts";

declare namespace hostTypesModule {
  interface FacetUses {
    readonly uses?: readonly contractTypes.AnyContract[];
  }

  interface Serve<P = unknown> {
    <D extends contractTypes.RemoteDef>(
      type: contractTypes.RemoteContract<D>,
      factory: serviceTypes.Factory<contractTypes.RemoteContract<D>, P>,
      options?: serviceTypes.ServeOptionsFor<contractTypes.RemoteContract<D>>,
    ): void;
    <D extends contractTypes.LocalDef>(
      type: contractTypes.LocalContract<D>,
      factory: serviceTypes.Factory<contractTypes.LocalContract<D>, P>,
      options?: serviceTypes.ServeOptionsFor<contractTypes.LocalContract<D>>,
    ): void;
  }

  type AnyServe = (
    type: contractTypes.AnyContract,
    factory: serviceTypes.Factory<contractTypes.AnyContract>,
    options?: serviceTypes.ServeOptions,
  ) => void;

  interface FacetApi<P = unknown> {
    readonly serve: Serve<P>;
    readonly name: string;
    root<T>(fn: (ctx: typesModule.Ctx<P>) => T | Promise<T>, options?: RootOptions<P>): Promise<T>;
    registry<V>(registry: registryTypes.Registry<V>): registryTypes.RegistryView<V>;
    readonly signal: AbortSignal;
  }

  interface FacetDefinition<P = unknown> {
    readonly uses?: readonly contractTypes.AnyContract[] | undefined;
    setup(api: FacetApi<P>): void;
  }

  interface Facet<P = unknown> extends FacetDefinition<P> {
    readonly name: string;
  }

  type FacetLoader = (modules: readonly (string | URL)[]) => Promise<Facet[]>;

  type PluginRef<P = unknown> = Facet<P> | string | URL;

  interface HostOptions<P = unknown> {
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
    readonly upstream?: { readonly link: linkTypes.Link } & ConnectOptions<P>;
  }

  interface ConnectOptions<P = unknown> extends connectionTypes.LinkOptions {
    readonly principal: P;
  }

  interface Route<P = unknown> {
    authorize(principal: P, hostName: string): boolean | Promise<boolean>;
    resolve(hostName: string): Promise<linkTypes.Link>;
    readonly principal: (hostName: string) => P;
  }

  type PrincipalPattern<P> = P extends object
    ? { readonly [K in keyof P]?: P[K] }
    : Readonly<Record<string, unknown>>;

  type PrincipalMatch<P = unknown> = ((principal: P) => boolean) | PrincipalPattern<P>;

  interface RootOptions<P = unknown> {
    readonly principal?: P;
    readonly signal?: AbortSignal | undefined;
    readonly codeVersion?: number;
  }

  interface LoadOptions {
    readonly awaitHostObjects?: boolean;
  }

  interface Host<P = unknown> {
    readonly name: string;
    readonly codeVersion: number;
    readonly previousCodeVersion: number | undefined;
    readonly serve: Serve<P>;
    install(facet: Facet<P>, options?: LoadOptions): Promise<void>;
    load(plugins: readonly PluginRef<P>[], options?: LoadOptions): Promise<void>;
    ready(): Promise<void>;
    get<C extends contractTypes.AnyContract>(
      type: C,
      input: contractTypes.InputOf<C>,
      options?: typesModule.GetOptions<P> & { readonly signal?: AbortSignal },
    ): Promise<contractTypes.Ref<C>>;
    hold<C extends contractTypes.AnyContract>(
      type: C,
      input: contractTypes.InputOf<C>,
      options?: typesModule.GetOptions<P>,
    ): contractTypes.Ref<C>;
    root<T>(fn: (ctx: typesModule.Ctx<P>) => T | Promise<T>, options?: RootOptions<P>): Promise<T>;
    registry<V>(registry: registryTypes.Registry<V>): registryTypes.RegistryView<V>;
    invalidatePrincipal(match: PrincipalMatch<P>): Promise<void>;
    accept(link: linkTypes.Link, options: connectionTypes.AcceptOptions<P>): void;
    connect(link: linkTypes.Link, options: ConnectOptions<P>): void;
    route(prefix: string, route: Route<P>): void;
    reload(
      plugins: readonly PluginRef<P>[],
      options?: reloadCandidateTypes.ReloadOptions,
    ): Promise<reloadCandidateTypes.ReloadReport>;
    close(): Promise<void>;
  }

  interface CodeVersionState {
    readonly id: number;
    readonly services: Map<string, serviceTypes.Service>;
    tables: ReadonlyMap<string, registryTypes.RegistryTable<unknown>>;
    readonly roots: Map<string, number>;
    readonly abort: AbortController;
  }
}

export type { hostTypesModule as default };
