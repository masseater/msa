import type contextRangeTypes from "./context-range.types.ts";

declare namespace contextTypes {
  type ContextBounds = contextRangeTypes.ContextBounds;

  type ContextRange = contextRangeTypes.ContextRange;
}

export type { contextTypes as default };
