import type { Static } from "typebox";

import type modelSchema from "./model-schema.ts";

declare namespace modelSchemaTypes {
  type ThinkingLevel = Static<typeof modelSchema.ThinkingLevelSchema>;

  type ModelThinkingLevel = Static<typeof modelSchema.ModelThinkingLevelSchema>;

  type ThinkingLevelMap = Static<typeof modelSchema.ThinkingLevelMapSchema>;

  type ModelInputModality = Static<typeof modelSchema.ModelInputModalitySchema>;

  type CacheRetention = Static<typeof modelSchema.CacheRetentionSchema>;

  type ModelPromptCache = Static<typeof modelSchema.ModelPromptCacheSchema>;

  type ModelCostRates = Static<typeof modelSchema.ModelCostRatesSchema>;

  type ModelCostTier = Static<typeof modelSchema.ModelCostTierSchema>;

  type ModelCost = Static<typeof modelSchema.ModelCostSchema>;

  type ModelImageResizeOptions = Static<typeof modelSchema.ModelImageResizeOptionsSchema>;

  type ModelImageInputLimits = Static<typeof modelSchema.ModelImageInputLimitsSchema>;

  type ModelInputLimits = Static<typeof modelSchema.ModelInputLimitsSchema>;
}

export type { modelSchemaTypes as default };
