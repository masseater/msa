import { Effect } from "effect";

import { type AnyContract, type InputOf, placedOn, placementText, type Ref } from "./contract.ts";
import type { RefCore } from "./core.ts";
import { ChordError } from "./errors.ts";
import { HostRemote } from "./host-remote.ts";
import {
  type AnyServe,
  type Facet,
  type FacetApi,
  isFacet,
  type LoadOptions,
  type PluginRef,
  type Serve,
} from "./host-types.ts";
import { hostLifetime, makeService, type Service } from "./service.ts";
import { awaitReady } from "./signal.ts";
import type { GetOptions } from "./types.ts";

export abstract class HostFacets extends HostRemote {
  readonly #facetRuns = new Map<string, AbortController>();

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

  load(plugins: readonly PluginRef[], options: LoadOptions = {}): Promise<void> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const facets = yield* this.resolve(plugins);
        yield* Effect.promise(() =>
          Promise.all(facets.map((facet) => this.install(facet, options))),
        );
      }),
    );
  }

  ready(): Promise<void> {
    return this.#hostObjectsReady(this.hostObjects.values());
  }

  #hostObjectsReady(refs: Iterable<RefCore>): Promise<void> {
    const ready = Promise.all([...refs].map((ref) => ref.ready)).then(() => undefined);
    ready.catch(() => {});
    return ready;
  }

  resolve(plugins: readonly PluginRef[]): Effect.Effect<Facet[]> {
    return Effect.gen({ self: this }, function* () {
      const modules = plugins.filter((ref): ref is string | URL => !isFacet(ref));
      const loader = this.options.loader;
      if (modules.length > 0 && loader === undefined) {
        throw new Error(
          "loading modules needs createHost({ loader }), e.g. nodeLoader from @msa/chord/node",
        );
      }
      const loaded =
        modules.length > 0 && loader !== undefined
          ? yield* Effect.promise(() => loader(modules))
          : [];
      return plugins.map((ref) => (isFacet(ref) ? ref : loaded.shift()!));
    });
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

  protected endFacetRuns(): void {
    for (const name of [...this.#facetRuns.keys()]) this.facetRunChanged(name, undefined);
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

  get<C extends AnyContract>(
    type: C,
    input: InputOf<C>,
    options?: GetOptions & { readonly signal?: AbortSignal },
  ): Promise<Ref<C>> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const ref = this.acquire(type, input, options, "external");
        return awaitReady(
          ref,
          options?.signal === undefined ? [] : [options.signal],
          this.readyTimeout,
        ).pipe(Effect.as(ref.proxy as Ref<C>));
      }),
    );
  }
}
