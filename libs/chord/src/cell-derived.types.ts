import type cellDerived from "./cell-derived.ts";
import type typesModule from "./types.types.ts";

declare namespace cellDerivedTypes {
  type Sources = readonly typesModule.Readable<unknown>[];

  type SourceValues<S extends Sources> = {
    [K in keyof S]: S[K] extends typesModule.Readable<infer T> ? T : never;
  };

  type Derived<T> = InstanceType<typeof cellDerived.Derived<T>>;
}

export type { cellDerivedTypes as default };
