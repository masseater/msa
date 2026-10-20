import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

declare namespace openaiCompletionsCompatTypes {
  type OpenAICompletionsOptions = openaiCompletionsTypesModule.OpenAICompletionsOptions;

  type ResolvedOpenAICompletionsCompat =
    openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
}

export type { openaiCompletionsCompatTypes as default };
