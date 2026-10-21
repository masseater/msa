import type readToolArgsTypes from "./read-tool-args.types.ts";
import type readToolScanTypes from "./read-tool-scan.types.ts";

declare namespace readToolStatsTypes {
  type Args = readToolArgsTypes.Args;
  type ReadRecord = readToolScanTypes.ReadRecord;
}

export type { readToolStatsTypes as default };
