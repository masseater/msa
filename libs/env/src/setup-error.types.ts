import type setupError from "./setup-error.ts";

declare namespace setupErrorTypes {
  type SetupError = (typeof setupError.SetupError)["prototype"];
}

export type { setupErrorTypes as default };
