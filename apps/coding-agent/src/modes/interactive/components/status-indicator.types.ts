import type BranchSummaryStatusIndicatorClass from "./branch-summary-status-indicator.ts";
import type CompactionStatusIndicatorClass from "./compaction-status-indicator.ts";
import type IdleStatusClass from "./idle-status.ts";
import type RetryStatusIndicatorClass from "./retry-status-indicator.ts";
import type StatusIndicatorClass from "./status-indicator.ts";
import type WorkingStatusIndicatorClass from "./working-status-indicator.ts";

declare namespace statusIndicatorTypes {
  type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

  type CompactionStatusReason = "manual" | "threshold" | "overflow";

  type StatusIndicator = (typeof StatusIndicatorClass)["prototype"];

  type WorkingStatusIndicator = (typeof WorkingStatusIndicatorClass)["prototype"];

  type RetryStatusIndicator = (typeof RetryStatusIndicatorClass)["prototype"];

  type CompactionStatusIndicator = (typeof CompactionStatusIndicatorClass)["prototype"];

  type BranchSummaryStatusIndicator = (typeof BranchSummaryStatusIndicatorClass)["prototype"];

  type IdleStatus = (typeof IdleStatusClass)["prototype"];
}

export type { statusIndicatorTypes as default };
