import type BranchSummaryMessageComponentClass from "./branch-summary-message.ts";

declare namespace branchSummaryMessageTypes {
  type BranchSummaryMessageComponent = (typeof BranchSummaryMessageComponentClass)["prototype"];
}

export type { branchSummaryMessageTypes as default };
