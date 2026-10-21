import type connectionTypes from "./connection.types.ts";
import type HostRootsClass from "./host-roots.ts";

declare namespace hostRootsTypes {
  interface JoinOptions {
    readonly principal?: unknown;
    readonly signal?: AbortSignal | undefined;
    readonly from?: connectionTypes.Connection;
  }

  type HostRoots = HostRootsClass;
}

export type { hostRootsTypes as default };
