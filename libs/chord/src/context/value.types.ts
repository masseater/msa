import type ContextValueClass from "./value.ts";

declare namespace valueTypes {
  type ContextValue<T> = ContextValueClass<T>;
}

export type { valueTypes as default };
