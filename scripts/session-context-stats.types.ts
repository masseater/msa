import type cliOptionsTypes from "./cli-options.types.ts";
import type hostTypes from "./host.types.ts";

declare namespace sessionContextStatsTypes {
  type CliOption<A, E> = cliOptionsTypes.CliOption<A, E>;
  type HostShape = hostTypes.HostShape;
}

export type { sessionContextStatsTypes as default };
