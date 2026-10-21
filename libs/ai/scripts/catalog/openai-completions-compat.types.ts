import type typesModule from "../../src/types.types.ts";

declare namespace openaiCompletionsCompatTypes {
  type OpenAICompletionsResolvedCompat = Required<
    Omit<
      typesModule.OpenAICompletionsCompat,
      | "cacheControlFormat"
      | "sessionAffinityFormat"
      | "supportsThinkingTokenBudget"
      | "thinkingTokenBudgetField"
      | "vllmPriority"
    >
  > & {
    cacheControlFormat?: typesModule.OpenAICompletionsCompat["cacheControlFormat"];
  };
}

export type { openaiCompletionsCompatTypes as default };
