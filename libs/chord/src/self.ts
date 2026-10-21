import type { Static, TSchema } from "typebox";

import type cellTypes from "./cell.types.ts";
import type contractTypes from "./contract.types.ts";
import type declsTypes from "./decls.types.ts";
import type objectTypes from "./object.types.ts";
import type registryTypes from "./registry.types.ts";
import selfKit from "./self-kit.ts";
import type selfResourcesTypes from "./self-resources.types.ts";
import type serviceTypes from "./service.types.ts";
import type typesModule from "./types.types.ts";

const { cell: cellModule, decls: declsModule, errors: errorsModule, selfResources } = selfKit;

const { Decls, isStateInit } = declsModule;
const { invalid } = errorsModule;
const { Cell, Derived } = cellModule;
const { declareResource, exposeResource } = selfResources;

export default class SelfImpl implements serviceTypes.Self {
  readonly #object: objectTypes.ObjectImpl;
  readonly #previous: declsTypes.Decls | undefined;
  readonly #decls = new Decls();
  readonly #created: declsTypes.Run["created"] = {
    derives: [],
    inits: [],
    refs: [],
    resources: [],
  };

  constructor(object: objectTypes.ObjectImpl, previous: declsTypes.Decls | undefined) {
    this.#object = object;
    this.#previous = previous;
  }

  run(implementation: unknown): declsTypes.Run {
    return {
      created: this.#created,
      decls: this.#decls,
      implementation: implementation as Record<string, unknown>,
    };
  }

  #unique(map: ReadonlyMap<string, unknown>, kind: string, name: string): void {
    if (typeof name !== "string" || name === "") throw new TypeError(`${kind} needs a name`);
    if (map.has(name))
      throw invalid("duplicate", `${this.#object.typeName}: duplicate ${kind} name ${name}`);
  }

  state<S extends TSchema>(
    name: string,
    schema: S,
    initial: Static<S> | serviceTypes.StateInit<Static<S>>,
    options: serviceTypes.StateOptions<Static<S>> = {},
  ): cellTypes.Cell<Static<S>> {
    this.#unique(this.#decls.cells, "state", name);
    const version = options.version ?? 1;
    if (!Number.isInteger(version) || version < 1)
      throw new TypeError(`state ${name}: version must be a positive integer`);
    const host = this.#object.host;
    const init = isStateInit(initial) ? initial.init : undefined;
    let cell = this.#previous?.cells.get(name);
    if (cell === undefined) {
      cell = new Cell<unknown>(
        name,
        schema,
        init === undefined ? { value: initial } : undefined,
        this.#object.calls.guard,
        {
          dev: host.dev,
          report: (error) => host.report(error),
        },
      );
      if (init !== undefined) this.#created.inits.push([cell, init]);
    }
    this.#decls.cells.set(name, cell);
    this.#decls.cellSchemas.set(name, schema);
    this.#decls.cellVersions.set(name, version);
    if (options.migrate !== undefined) this.#decls.cellMigrations.set(name, options.migrate);
    return cell as cellTypes.Cell<Static<S>>;
  }

  get<C extends contractTypes.AnyContract>(
    type: C,
    input: contractTypes.InputOf<C>,
    options?: typesModule.GetOptions,
  ): contractTypes.Ref<C> {
    const host = this.#object.host;
    const candidate = this.#previous !== undefined;
    const address = host.addressOf(type, input, options?.principal ?? host.principal, candidate);
    const declared = this.#decls.refs.get(address);
    if (declared !== undefined) {
      if (declared.contract.fingerprint !== type.fingerprint) {
        throw invalid(
          "duplicate",
          `${this.#object.typeName}: ${type.name} held twice with different contracts`,
        );
      }
      return declared.proxy as contractTypes.Ref<C>;
    }
    const existing = this.#previous?.refs.get(address);
    if (
      existing !== undefined &&
      existing.contract.fingerprint === type.fingerprint &&
      existing.status !== "gone" &&
      existing.status !== "released"
    ) {
      this.#decls.refs.set(address, existing);
      return existing.proxy as contractTypes.Ref<C>;
    }
    const ref = host.acquire(type, input, options, "object", this.#object, candidate);
    this.#decls.refs.set(address, ref);
    this.#created.refs.push(ref);
    return ref.proxy as contractTypes.Ref<C>;
  }

  resource<T>(
    name: string,
    declaration: selfResourcesTypes.ResourceDeclaration<T>,
  ): selfResourcesTypes.Resource<T> {
    this.#unique(this.#decls.resources, "resource", name);
    return declareResource(
      {
        created: this.#created,
        decls: this.#decls,
        host: this.#object.host,
        previous: this.#previous,
      },
      name,
      declaration,
    );
  }

  on(name: string, source: unknown, ...rest: readonly unknown[]): void {
    this.#unique(this.#decls.listeners, "listener", name);
    const [select, fn] = rest.length === 1 ? [undefined, rest[0]] : [rest[0], rest[1]];
    if (typeof fn !== "function")
      throw new TypeError(`listener ${name}: the handler must be a function`);
    if (select !== undefined && typeof select !== "function")
      throw new TypeError(`listener ${name}: select must be a function`);
    this.#decls.listeners.set(name, {
      fn: fn as selfResourcesTypes.ListenerDecl["fn"],
      select: select as selfResourcesTypes.ListenerDecl["select"],
      source,
    });
  }

  task(fn: (ctx: typesModule.Ctx) => Promise<void>): void {
    if (typeof fn !== "function") throw new TypeError("a task must be a function");
    this.#decls.tasks.set(`#${this.#decls.tasks.size}`, fn);
  }

  derive<const S extends cellTypes.Sources, T>(
    sources: S,
    fn: (...values: cellTypes.SourceValues<S>) => T,
  ): typesModule.Readable<T> {
    if (typeof fn !== "function") throw new TypeError("a derivation needs a function");
    const host = this.#object.host;
    const key = `#${this.#decls.derives.size}`;
    const derived = new Derived(key, sources, fn as unknown as (...values: never[]) => unknown, {
      dev: host.dev,
      report: (error) => host.report(error),
    });
    this.#created.derives.push(derived);
    this.#decls.derives.set(key, derived);
    return derived as unknown as typesModule.Readable<T>;
  }

  expose<T>(resource: selfResourcesTypes.Resource<T>): typesModule.Exposed<T> {
    return exposeResource(this.#decls, resource);
  }

  register<V>(registry: registryTypes.Registry<V>, entries: Readonly<Record<string, V>>): void {
    if (!this.#object.hostLifetime)
      throw invalid(
        "not_host_lifetime",
        `${this.#object.typeName}: only objects of lifetime "host" may register`,
      );
    for (const [key, value] of Object.entries(entries)) {
      const id = `${registry.name}\u0000${key}`;
      this.#unique(this.#decls.registrations, "register", id);
      this.#decls.registrations.set(id, {
        key,
        registry: registry as registryTypes.Registry<unknown>,
        value,
      });
    }
  }
}
