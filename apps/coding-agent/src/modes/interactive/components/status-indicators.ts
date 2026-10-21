import createBranchSummaryStatusIndicator from "./branch-summary-status-indicator.ts";
import createCompactionStatusIndicator from "./compaction-status-indicator.ts";
import IdleStatus from "./idle-status.ts";
import createRetryStatusIndicator from "./retry-status-indicator.ts";
import StatusIndicator from "./status-indicator.ts";
import createWorkingStatusIndicator from "./working-status-indicator.ts";

const statusIndicators = {
  IdleStatus,
  StatusIndicator,
  createBranchSummaryStatusIndicator,
  createCompactionStatusIndicator,
  createRetryStatusIndicator,
  createWorkingStatusIndicator,
};

export default statusIndicators;
