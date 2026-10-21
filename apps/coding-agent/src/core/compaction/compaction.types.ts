import type compactionTokensTypes from "./compaction-tokens.types.ts";
import type compactionTypesTypes from "./compaction-types.types.ts";

declare namespace compactionTypes {
  type ContextUsageEstimate = compactionTokensTypes.ContextUsageEstimate;

  type CompactionDetails = compactionTypesTypes.CompactionDetails;

  type CompactionPreparation = compactionTypesTypes.CompactionPreparation;

  type CompactionResult<T = unknown> = compactionTypesTypes.CompactionResult<T>;

  type CompactionSettings = compactionTypesTypes.CompactionSettings;

  type CutPointResult = compactionTypesTypes.CutPointResult;
}

export type { compactionTypes as default };
