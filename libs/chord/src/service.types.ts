import type { Static, TSchema } from "typebox";

import type cellTypes from "./cell.types.ts";
import type contractTypes from "./contract.types.ts";
import type declareTypes from "./declare.ts";
import type registryTypes from "./registry.types.ts";
import type typesModule from "./types.types.ts";

declare namespace serviceTypes {
  type ServeOptions = ReferencedServeOptions | HostServeOptions;

  interface ReferencedServeOptions {
    readonly lifetime?: "referenced";
    readonly linger?: number;
    readonly accepts?: contractTypes.Accepts;
  }

  interface HostServeOptions {
    readonly lifetime: "host";
    readonly linger?: undefined;
    readonly accepts?: contractTypes.Accepts;
  }

  type ServeOptionsFor<C extends contractTypes.AnyContract> = C extends contractTypes.LocalContract
    ? Record<never, never> extends contractTypes.InputOf<C>
      ? ServeOptions
      : ReferencedServeOptions
    : ReferencedServeOptions;

  type Lifetime = "referenced" | "host";

  type Factory<C extends contractTypes.AnyContract, P = unknown> = (
    input: contractTypes.InputOf<C>,
    principal: P,
    self: Self<P>,
  ) => contractTypes.ImplementationOf<C, P>;

  type AnyFactory = (input: unknown, principal: unknown, self: Self) => unknown;

  interface Service {
    readonly contract: contractTypes.AnyContract;
    readonly factory: AnyFactory;
    readonly options: ServeOptions;
    readonly facet: string;
  }

  interface StateOptions<T> {
    readonly version?: number;
    readonly migrate?: (old: unknown, from: number) => T;
  }

  interface StateInit<T, P = unknown> {
    readonly init: (ctx: typesModule.Ctx<P>) => T | Promise<T>;
  }

  interface Self<P = unknown> {
    state<S extends TSchema>(
      name: string,
      schema: S,
      initial: Static<S> | StateInit<Static<S>, P>,
      options?: StateOptions<Static<S>>,
    ): cellTypes.Cell<Static<S>>;
    get<C extends contractTypes.AnyContract>(
      type: C,
      input: contractTypes.InputOf<C>,
      options?: typesModule.GetOptions<P>,
    ): contractTypes.Ref<C>;
    resource<T>(
      name: string,
      declaration: declareTypes.ResourceDeclaration<T>,
    ): declareTypes.Resource<T>;
    on<S>(
      name: string,
      source: S,
      handler: (event: declareTypes.EventOf<S>, ctx: typesModule.Ctx<P>) => void | Promise<void>,
    ): void;
    on<S, E>(
      name: string,
      source: S,
      select: (value: declareTypes.ValueOf<S>) => declareTypes.Subscribable<E>,
      handler: (event: E, ctx: typesModule.Ctx<P>) => void | Promise<void>,
    ): void;
    task(fn: (ctx: typesModule.Ctx<P>) => Promise<void>): void;
    derive<const S extends cellTypes.Sources, T>(
      sources: S,
      fn: (...values: cellTypes.SourceValues<S>) => T,
    ): typesModule.Readable<T>;
    register<V>(registry: registryTypes.Registry<V>, entries: Readonly<Record<string, V>>): void;
    expose<T>(resource: declareTypes.Resource<T>): typesModule.Exposed<T>;
  }
}

export type { serviceTypes as default };
