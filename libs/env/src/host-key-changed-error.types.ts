import type hostKeyChangedError from "./host-key-changed-error.ts";

declare namespace hostKeyChangedErrorTypes {
  type HostKeyChangedError = (typeof hostKeyChangedError.HostKeyChangedError)["prototype"];
}

export type { hostKeyChangedErrorTypes as default };
