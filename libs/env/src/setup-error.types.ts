import type SetupErrorClass from "./setup-error.ts";

declare namespace setupErrorTypes {
  type SetupError = SetupErrorClass;
}

export type { setupErrorTypes as default };
