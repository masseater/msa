import type cliOptionsTypes from "./cli-options.types.ts";
import type hostTypes from "./host.types.ts";
import type toolStatsReportTypes from "./tool-stats-report.types.ts";
import type toolStatsScanTypes from "./tool-stats-scan.types.ts";

declare namespace toolStatsTypes {
  type CliOption<A, E> = cliOptionsTypes.CliOption<A, E>;
  type HostShape = hostTypes.HostShape;
  type HistogramRow = toolStatsReportTypes.HistogramRow;
  type BashCommandStats = toolStatsScanTypes.BashCommandStats;
  type ToolStats = toolStatsScanTypes.ToolStats;
}

export type { toolStatsTypes as default };
