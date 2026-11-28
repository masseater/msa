import type cliOptionsTypes from "./cli-options.types.ts";
import type editToolScanTypes from "./edit-tool-scan.types.ts";
import type hostTypes from "./host.types.ts";

declare namespace editToolStatsTypes {
  type CliOption<A, E> = cliOptionsTypes.CliOption<A, E>;
  type EditRecord = editToolScanTypes.EditRecord;
  type HostShape = hostTypes.HostShape;
}

export type { editToolStatsTypes as default };
