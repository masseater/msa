import type { OpenAICompletionsCompat } from "../../src/types.ts";

declare namespace openaiCompletionsCompatTypes {
  type OpenAICompletionsResolvedCompat = Required<
    Omit<
      OpenAICompletionsCompat,
      | "cacheControlFormat"
      | "sessionAffinityFormat"
      | "supportsThinkingTokenBudget"
      | "thinkingTokenBudgetField"
      | "vllmPriority"
    >
  > & {
    cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
  };
}

export type { openaiCompletionsCompatTypes as default };
