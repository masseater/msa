import type branchSummarizationTypes from "./branch-summarization.types.ts";
import type compactionTypesModule from "./compaction.types.ts";
import type utilsTypes from "./utils.types.ts";

declare namespace compactionTypes {
  type BranchPreparation = branchSummarizationTypes.BranchPreparation;

  type BranchSummaryDetails = branchSummarizationTypes.BranchSummaryDetails;

  type CollectEntriesResult = branchSummarizationTypes.CollectEntriesResult;

  type BranchSummaryResult = branchSummarizationTypes.BranchSummaryResult;

  type GenerateBranchSummaryOptions = branchSummarizationTypes.GenerateBranchSummaryOptions;

  type ContextUsageEstimate = compactionTypesModule.ContextUsageEstimate;

  type CompactionDetails = compactionTypesModule.CompactionDetails;

  type CompactionPreparation = compactionTypesModule.CompactionPreparation;

  type CompactionResult<T = unknown> = compactionTypesModule.CompactionResult<T>;

  type CompactionSettings = compactionTypesModule.CompactionSettings;

  type CutPointResult = compactionTypesModule.CutPointResult;

  type FileOperations = utilsTypes.FileOperations;
}

export type { compactionTypes as default };
