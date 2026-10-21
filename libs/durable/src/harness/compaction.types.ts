import type compactionTypesModule from "./compaction-types.ts";

declare namespace compactionTypes {
  type CompactionCheckpoint = compactionTypesModule.CompactionCheckpoint;

  type CompactionInput = compactionTypesModule.CompactionInput;

  type SummaryRequest = compactionTypesModule.SummaryRequest;
}

export type { compactionTypes as default };
