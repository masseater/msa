import type IdleStatusClass from "./idle-status.ts";
import type StatusIndicatorClass from "./status-indicator.ts";

declare namespace statusIndicatorTypes {
  type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

  type CompactionStatusReason = "manual" | "threshold" | "overflow";

  type StatusIndicator = (typeof StatusIndicatorClass)["prototype"];

  type IdleStatus = (typeof IdleStatusClass)["prototype"];
}

export type { statusIndicatorTypes as default };
