import type host from "./host.ts";

declare namespace hostTypes {
  type CodemodeSandbox = (typeof host.CodemodeSandbox)["prototype"];
}

export type { hostTypes as default };
