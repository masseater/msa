import type ForeignErrorClass from "./foreign-error.ts";

declare namespace foreignErrorTypes {
  type ForeignError = (typeof ForeignErrorClass)["prototype"];
}

export type { foreignErrorTypes as default };
