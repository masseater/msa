import type typesModule from "./types.types.ts";

declare namespace declareTypes {
  interface Subscribable<E> {
    subscribe(listener: (event: E) => void): () => void;
  }

  interface ResourceDeclaration<T> {
    readonly version: number;
    readonly deps?: readonly unknown[];
    readonly exclusive?: boolean;
    open(options: { readonly signal: AbortSignal }): T | Promise<T>;
    close?(value: T): void | Promise<void>;
  }

  interface Resource<T> {
    readonly key: string;
    readonly value: T;
  }

  interface ListenerDecl {
    readonly source: unknown;
    readonly select: ((value: never) => Subscribable<unknown>) | undefined;
    readonly fn: (event: unknown, ctx: typesModule.Ctx) => void | Promise<void>;
  }

  type ValueOf<S> = S extends Subscribable<unknown> ? S : S extends Resource<infer T> ? T : S;

  type EventOf<S> =
    S extends Subscribable<infer E> ? E : S extends Resource<infer T> ? EventOf<T> : never;
}

export type { declareTypes as default };
