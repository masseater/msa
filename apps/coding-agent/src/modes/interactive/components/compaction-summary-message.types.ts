import type CompactionSummaryMessageComponentClass from "./compaction-summary-message.ts";

declare namespace compactionSummaryMessageTypes {
  type CompactionSummaryMessageComponent =
    (typeof CompactionSummaryMessageComponentClass)["prototype"];
}

export type { compactionSummaryMessageTypes as default };
