import type contextTypes from "./index.types.ts";

declare namespace typesModule {
  type ContextKey<T> = contextTypes.ContextKey<T>;

  type Context = contextTypes.Context;
}

export type { typesModule as default };
