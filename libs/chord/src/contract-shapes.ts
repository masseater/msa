import type { Static, TSchema } from "typebox";

import type {
  AnyContract,
  LocalContract,
  LocalMember,
  MethodSpec,
  OpaqueSpec,
  RemoteContract,
} from "./contract.ts";
import type { Ctx, Exposed, Readable, RefBase, StateSource } from "./types.ts";

type Empty = Record<never, never>;
type StateOf<V> = V extends { readonly state: infer S extends Readonly<Record<string, TSchema>> }
  ? S
  : Empty;
type StaticOf<S> = S extends TSchema ? Static<S> : never;
type MethodsOf<V> = V extends {
  readonly methods: infer M extends Readonly<Record<string, MethodSpec>>;
}
  ? M
  : Empty;

type Returned<R> = [R] extends [TSchema] ? Static<R> | Promise<Static<R>> : void | Promise<void>;
type Resolved<R> = [R] extends [TSchema] ? Static<R> : undefined;

export type MethodImplementation<M, P = unknown> =
  M extends MethodSpec<infer A, infer R>
    ? [A] extends [TSchema]
      ? (args: Static<A>, ctx: Ctx<P>) => Returned<R>
      : (ctx: Ctx<P>) => Returned<R>
    : never;
export type Call<M> =
  M extends MethodSpec<infer A, infer R>
    ? [A] extends [TSchema]
      ? (args: Static<A>, ctx?: Ctx) => Promise<Resolved<R>>
      : (ctx?: Ctx) => Promise<Resolved<R>>
    : never;

type VariantImplementation<K, V, P> = { readonly variant: K } & {
  readonly [S in keyof StateOf<V>]: StateSource<StaticOf<StateOf<V>[S]>>;
} & {
  readonly [M in keyof MethodsOf<V>]: MethodImplementation<MethodsOf<V>[M], P>;
};
type VariantRef<C extends AnyContract, K, V> = RefBase<C> & { readonly variant: K } & {
  readonly [S in keyof StateOf<V>]: Readable<StaticOf<StateOf<V>[S]>>;
} & {
  readonly [M in keyof MethodsOf<V>]: Call<MethodsOf<V>[M]>;
};

type LocalImplementationMember<M, P> = M extends MethodSpec
  ? MethodImplementation<M, P>
  : M extends OpaqueSpec<infer T>
    ? T | Exposed<T>
    : M extends TSchema
      ? StateSource<Static<M>>
      : never;
type LocalRefMember<M> = M extends MethodSpec
  ? Call<M>
  : M extends OpaqueSpec<infer T>
    ? T | undefined
    : M extends TSchema
      ? Readable<Static<M>>
      : never;
type LocalMembers<D> = D extends {
  readonly members: infer M extends Readonly<Record<string, LocalMember>>;
}
  ? M
  : Empty;

export type InputOf<C> = C extends { readonly def: { readonly input: infer I extends TSchema } }
  ? Static<I>
  : never;

export type ImplementationOf<C, P = unknown> =
  C extends RemoteContract<infer D>
    ? {
        [K in keyof D["variants"]]: VariantImplementation<K, D["variants"][K], P>;
      }[keyof D["variants"]]
    : C extends LocalContract<infer D>
      ? {
          readonly [K in keyof LocalMembers<D>]: LocalImplementationMember<LocalMembers<D>[K], P>;
        } & Record<string, unknown>
      : never;

export type Ref<C extends AnyContract = AnyContract> =
  C extends RemoteContract<infer D>
    ? { [K in keyof D["variants"]]: VariantRef<C, K, D["variants"][K]> }[keyof D["variants"]]
    : C extends LocalContract<infer D>
      ? RefBase<C> & { readonly [K in keyof LocalMembers<D>]: LocalRefMember<LocalMembers<D>[K]> }
      : never;
