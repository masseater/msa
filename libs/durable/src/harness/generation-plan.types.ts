import type generationThresholdTypes from "./generation-threshold.types.ts";
import type promptTypes from "./prompt.types.ts";

declare namespace generationPlanTypes {
  type PromptPlan = {
    readonly entries: readonly promptTypes.SystemDraft[];
    readonly threshold: generationThresholdTypes.ThresholdOutcome;
  };
}

export type { generationPlanTypes as default };
