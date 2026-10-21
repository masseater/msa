import type host from "./host.ts";

declare namespace hostTypes {
  type HostImpl = (typeof host.HostImpl)["prototype"];
}

export type { hostTypes as default };
