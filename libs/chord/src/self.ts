import type { Static, TSchema } from "typebox";

import { Cell, Derived, type Sources, type SourceValues } from "./cell.ts";
import type { AnyContract, InputOf, Ref } from "./contract.ts";
import { Decls, isStateInit, type Run } from "./decls.ts";
import { invalid } from "./errors.ts";
import type { ObjectImpl } from "./object.ts";
import type { Registry } from "./registry.ts";
import {
  declareResource,
  exposeResource,
  type ListenerDecl,
  type Resource,
  type ResourceDeclaration,
} from "./self-resources.ts";
import type { Self, StateInit, StateOptions } from "./service.ts";
import type { Ctx, Exposed, GetOptions, Readable } from "./types.ts";

export class SelfImpl implements Self {
  readonly #object: ObjectImpl;
  readonly #previous: Decls | undefined;
  readonly #decls = new Decls();
  readonly #created: Run["created"] = { refs: [], resources: [], derives: [], inits: [] };

  constructor(object: ObjectImpl, previous: Decls | undefined) {
    this.#object = object;
    this.#previous = previous;
  }

  run(implementation: unknown): Run {
    return {
      implementation: implementation as Record<string, unknown>,
      decls: this.#decls,
      created: this.#created,
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
    initial: Static<S> | StateInit<Static<S>>,
    options: StateOptions<Static<S>> = {},
  ): Cell<Static<S>> {
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
    return cell as Cell<Static<S>>;
  }

  get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Ref<C> {
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
      return declared.proxy as Ref<C>;
    }
    const existing = this.#previous?.refs.get(address);
    if (
      existing !== undefined &&
      existing.contract.fingerprint === type.fingerprint &&
      existing.status !== "gone" &&
      existing.status !== "released"
    ) {
      this.#decls.refs.set(address, existing);
      return existing.proxy as Ref<C>;
    }
    const ref = host.acquire(type, input, options, "object", this.#object, candidate);
    this.#decls.refs.set(address, ref);
    this.#created.refs.push(ref);
    return ref.proxy as Ref<C>;
  }

  resource<T>(name: string, declaration: ResourceDeclaration<T>): Resource<T> {
    this.#unique(this.#decls.resources, "resource", name);
    return declareResource(
      {
        decls: this.#decls,
        created: this.#created,
        previous: this.#previous,
        host: this.#object.host,
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
      source,
      select: select as ListenerDecl["select"],
      fn: fn as ListenerDecl["fn"],
    });
  }

  task(fn: (ctx: Ctx) => Promise<void>): void {
    if (typeof fn !== "function") throw new TypeError("a task must be a function");
    this.#decls.tasks.set(`#${this.#decls.tasks.size}`, fn);
  }

  derive<const S extends Sources, T>(
    sources: S,
    fn: (...values: SourceValues<S>) => T,
  ): Readable<T> {
    if (typeof fn !== "function") throw new TypeError("a derivation needs a function");
    const host = this.#object.host;
    const key = `#${this.#decls.derives.size}`;
    const derived = new Derived(key, sources, fn as unknown as (...values: never[]) => unknown, {
      dev: host.dev,
      report: (error) => host.report(error),
    });
    this.#created.derives.push(derived);
    this.#decls.derives.set(key, derived);
    return derived as unknown as Readable<T>;
  }

  expose<T>(resource: Resource<T>): Exposed<T> {
    return exposeResource(this.#decls, resource);
  }

  register<V>(registry: Registry<V>, entries: Readonly<Record<string, V>>): void {
    if (!this.#object.hostLifetime)
      throw invalid(
        "not_host_lifetime",
        `${this.#object.typeName}: only objects of lifetime "host" may register`,
      );
    for (const [key, value] of Object.entries(entries)) {
      const id = `${registry.name}\u0000${key}`;
      this.#unique(this.#decls.registrations, "register", id);
      this.#decls.registrations.set(id, { registry: registry as Registry<unknown>, key, value });
    }
  }
}
