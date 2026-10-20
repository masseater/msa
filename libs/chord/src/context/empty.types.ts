import type EmptyContextClass from "./empty.ts";

declare namespace emptyTypes {
  type EmptyContext = EmptyContextClass;
}

export type { emptyTypes as default };
