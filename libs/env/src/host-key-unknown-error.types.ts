import type hostKeyUnknownError from "./host-key-unknown-error.ts";

declare namespace hostKeyUnknownErrorTypes {
  type HostKeyUnknownError = (typeof hostKeyUnknownError.HostKeyUnknownError)["prototype"];
}

export type { hostKeyUnknownErrorTypes as default };
