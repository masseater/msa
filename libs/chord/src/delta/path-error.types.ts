import type PathErrorClass from "./path-error.ts";

declare namespace pathErrorTypes {
  type PathError = PathErrorClass;
}

export type { pathErrorTypes as default };
