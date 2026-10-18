import { dual } from "effect/Function";
import type { Static, TSchema } from "typebox";

import { type Cell, isSource, type Sources, type SourceValues } from "./cell.ts";
import {
  type Accepts,
  type AnyContract,
  type ImplementationOf,
  type InputOf,
  LOCAL_VARIANT,
  type LocalContract,
  type MemberDescription,
  type Ref,
} from "./contract.ts";
import type { EventOf, Resource, ResourceDeclaration, Subscribable, ValueOf } from "./declare.ts";
import { invalid } from "./errors.ts";
import type { Registry } from "./registry.ts";
import { normalize } from "./schema.ts";
import type { Ctx, Exposed, GetOptions, Readable } from "./types.ts";

export type ServeOptions = ReferencedServeOptions | HostServeOptions;

export interface ReferencedServeOptions {
  readonly lifetime?: "referenced";
  readonly linger?: number;
  readonly accepts?: Accepts;
}

export interface HostServeOptions {
  readonly lifetime: "host";
  readonly linger?: undefined;
  readonly accepts?: Accepts;
}

export type ServeOptionsFor<C extends AnyContract> = C extends LocalContract
  ? Record<never, never> extends InputOf<C>
    ? ServeOptions
    : ReferencedServeOptions
  : ReferencedServeOptions;

export type Lifetime = "referenced" | "host";

export type Factory<C extends AnyContract, P = unknown> = (
  input: InputOf<C>,
  principal: P,
  self: Self<P>,
) => ImplementationOf<C, P>;
type AnyFactory = (input: unknown, principal: unknown, self: Self) => unknown;

export interface Service {
  readonly contract: AnyContract;
  readonly factory: AnyFactory;
  readonly options: ServeOptions;
  readonly facet: string;
}

export interface StateOptions<T> {
  readonly version?: number;
  readonly migrate?: (old: unknown, from: number) => T;
}

export interface StateInit<T, P = unknown> {
  readonly init: (ctx: Ctx<P>) => T | Promise<T>;
}

export interface Self<P = unknown> {
  state<S extends TSchema>(
    name: string,
    schema: S,
    initial: Static<S> | StateInit<Static<S>, P>,
    options?: StateOptions<Static<S>>,
  ): Cell<Static<S>>;
  get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions<P>): Ref<C>;
  resource<T>(name: string, declaration: ResourceDeclaration<T>): Resource<T>;
  on<S>(
    name: string,
    source: S,
    handler: (event: EventOf<S>, ctx: Ctx<P>) => void | Promise<void>,
  ): void;
  on<S, E>(
    name: string,
    source: S,
    select: (value: ValueOf<S>) => Subscribable<E>,
    handler: (event: E, ctx: Ctx<P>) => void | Promise<void>,
  ): void;
  task(fn: (ctx: Ctx<P>) => Promise<void>): void;
  derive<const S extends Sources, T>(
    sources: S,
    fn: (...values: SourceValues<S>) => T,
  ): Readable<T>;
  register<V>(registry: Registry<V>, entries: Readonly<Record<string, V>>): void;
  expose<T>(resource: Resource<T>): Exposed<T>;
}

function checkLifetime(contract: AnyContract, options: ServeOptions): void {
  const lifetime = options.lifetime ?? "referenced";
  if (lifetime !== "referenced" && lifetime !== "host")
    throw new TypeError(`${contract.name}: unknown lifetime ${String(lifetime)}`);
  if (lifetime !== "host") return;
  if (contract.scope !== "local")
    throw new TypeError(
      `${contract.name}: lifetime "host" needs a local type (remote types are referenced)`,
    );
  if (options.linger !== undefined)
    throw new TypeError(
      `${contract.name}: an object of lifetime "host" does not linger (it lives as long as the host)`,
    );
  try {
    normalize(contract.input, {}, `${contract.name} input`);
  } catch {
    throw new TypeError(
      `${contract.name}: lifetime "host" needs an input that accepts {} (the object's one address)`,
    );
  }
}

export const makeService: {
  <C extends AnyContract>(
    factory: Factory<C>,
    options: ServeOptions,
    facet: string,
  ): (contract: C) => Service;
  <C extends AnyContract>(
    contract: C,
    factory: Factory<C>,
    options: ServeOptions,
    facet: string,
  ): Service;
} = dual(
  4,
  <C extends AnyContract>(
    contract: C,
    factory: Factory<C>,
    options: ServeOptions,
    facet: string,
  ): Service => {
    checkLifetime(contract, options);
    return {
      contract,
      factory: factory as unknown as AnyFactory,
      options: options as ServeOptions,
      facet,
    };
  },
);

export const hostLifetime = (service: Service): boolean => service.options.lifetime === "host";

export const variantOf = (implementation: Record<string, unknown>): string | undefined =>
  typeof implementation["variant"] === "string" ? implementation["variant"] : undefined;

export const isReadableLike = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as Readable<unknown>).events === "function" &&
  typeof (value as Readable<unknown>).subscribe === "function";

export const isStateLike = (value: unknown): boolean => isSource(value) || isReadableLike(value);

export const memberSchemas: {
  (
    implementation: Record<string, unknown>,
  ): (service: Service) => Map<Readable<unknown>, TSchema[]>;
  (service: Service, implementation: Record<string, unknown>): Map<Readable<unknown>, TSchema[]>;
} = dual(
  2,
  (
    service: Service,
    implementation: Record<string, unknown>,
  ): Map<Readable<unknown>, TSchema[]> => {
    const schemas = new Map<Readable<unknown>, TSchema[]>();
    const contract = service.contract;
    if (contract.scope !== "remote") return schemas;
    const members = contract.description.variants[variantOf(implementation) ?? ""] ?? {};
    for (const [name, description] of Object.entries(members)) {
      const source = implementation[name];
      if (description.kind !== "state" || !isSource(source)) continue;
      schemas.set(source, [...(schemas.get(source) ?? []), description.schema]);
    }
    return schemas;
  },
);

function declaredMembers(
  contract: AnyContract,
  implementation: Record<string, unknown>,
  fail: (message: string) => never,
): Readonly<Record<string, MemberDescription>> {
  if (contract.scope !== "remote") return contract.description.variants[LOCAL_VARIANT] ?? {};
  const variant = implementation["variant"];
  if (typeof variant !== "string" || contract.description.variants[variant] === undefined)
    fail(`unknown variant ${String(variant)}`);
  const members = contract.description.variants[variant as string]!;
  for (const key of Object.keys(implementation))
    if (key !== "variant" && members[key] === undefined)
      fail(`${key} is not in variant ${String(variant)}`);
  return members;
}

export const validateImplementation: {
  (implementation: Record<string, unknown>): (service: Service) => void;
  (service: Service, implementation: Record<string, unknown>): void;
} = dual(2, (service: Service, implementation: Record<string, unknown>): void => {
  const contract = service.contract;
  const fail = (message: string): never => {
    throw invalid("implementation", `${contract.name}: ${message}`);
  };
  if (implementation === null || typeof implementation !== "object")
    fail("factory must return an object");
  const members = declaredMembers(contract, implementation, fail);
  for (const [name, description] of Object.entries(members)) {
    const value = implementation[name];
    if (description.kind === "method" && typeof value !== "function")
      fail(`${name} must be a method`);
    if (description.kind === "state" && !isSource(value) && !isReadableLike(value)) {
      fail(`${name} must be a cell, a derivation or a held object's state member`);
    }
    if (description.kind === "opaque" && value === undefined) fail(`${name} is missing`);
  }
});
