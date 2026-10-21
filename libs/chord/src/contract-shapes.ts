import type { Static, TSchema } from "typebox";

import type contractTypes from "./contract.types.ts";
import type typesModule from "./types.types.ts";

declare namespace contractShapesTypes {
  type Empty = Record<never, never>;

  type StateOf<V> = V extends { readonly state: infer S extends Readonly<Record<string, TSchema>> }
    ? S
    : Empty;

  type StaticOf<S> = S extends TSchema ? Static<S> : never;

  type MethodsOf<V> = V extends {
    readonly methods: infer M extends Readonly<Record<string, contractTypes.MethodSpec>>;
  }
    ? M
    : Empty;

  type Returned<R> = [R] extends [TSchema] ? Static<R> | Promise<Static<R>> : void | Promise<void>;

  type Resolved<R> = [R] extends [TSchema] ? Static<R> : undefined;

  type MethodImplementation<M, P = unknown> =
    M extends contractTypes.MethodSpec<infer A, infer R>
      ? [A] extends [TSchema]
        ? (args: Static<A>, ctx: typesModule.Ctx<P>) => Returned<R>
        : (ctx: typesModule.Ctx<P>) => Returned<R>
      : never;

  type Call<M> =
    M extends contractTypes.MethodSpec<infer A, infer R>
      ? [A] extends [TSchema]
        ? (args: Static<A>, ctx?: typesModule.Ctx) => Promise<Resolved<R>>
        : (ctx?: typesModule.Ctx) => Promise<Resolved<R>>
      : never;

  type VariantImplementation<K, V, P> = { readonly variant: K } & {
    readonly [S in keyof StateOf<V>]: typesModule.StateSource<StaticOf<StateOf<V>[S]>>;
  } & {
    readonly [M in keyof MethodsOf<V>]: MethodImplementation<MethodsOf<V>[M], P>;
  };

  type VariantRef<C extends contractTypes.AnyContract, K, V> = typesModule.RefBase<C> & {
    readonly variant: K;
  } & {
    readonly [S in keyof StateOf<V>]: typesModule.Readable<StaticOf<StateOf<V>[S]>>;
  } & {
    readonly [M in keyof MethodsOf<V>]: Call<MethodsOf<V>[M]>;
  };

  type LocalImplementationMember<M, P> = M extends contractTypes.MethodSpec
    ? MethodImplementation<M, P>
    : M extends contractTypes.OpaqueSpec<infer T>
      ? T | typesModule.Exposed<T>
      : M extends TSchema
        ? typesModule.StateSource<Static<M>>
        : never;

  type LocalRefMember<M> = M extends contractTypes.MethodSpec
    ? Call<M>
    : M extends contractTypes.OpaqueSpec<infer T>
      ? T | undefined
      : M extends TSchema
        ? typesModule.Readable<Static<M>>
        : never;

  type LocalMembers<D> = D extends {
    readonly members: infer M extends Readonly<Record<string, contractTypes.LocalMember>>;
  }
    ? M
    : Empty;

  type InputOf<C> = C extends { readonly def: { readonly input: infer I extends TSchema } }
    ? Static<I>
    : never;

  type ImplementationOf<C, P = unknown> =
    C extends contractTypes.RemoteContract<infer D>
      ? {
          [K in keyof D["variants"]]: VariantImplementation<K, D["variants"][K], P>;
        }[keyof D["variants"]]
      : C extends contractTypes.LocalContract<infer D>
        ? {
            readonly [K in keyof LocalMembers<D>]: LocalImplementationMember<LocalMembers<D>[K], P>;
          } & Record<string, unknown>
        : never;

  type Ref<C extends contractTypes.AnyContract = contractTypes.AnyContract> =
    C extends contractTypes.RemoteContract<infer D>
      ? { [K in keyof D["variants"]]: VariantRef<C, K, D["variants"][K]> }[keyof D["variants"]]
      : C extends contractTypes.LocalContract<infer D>
        ? typesModule.RefBase<C> & {
            readonly [K in keyof LocalMembers<D>]: LocalRefMember<LocalMembers<D>[K]>;
          }
        : never;
}

export type { contractShapesTypes as default };
