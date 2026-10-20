import type openaiCompletionsConvertStateTypes from "./openai-completions-convert-state.types.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

declare namespace openaiCompletionsTypes {
  type ConvertCompletionsMessagesOptions =
    openaiCompletionsConvertStateTypes.ConvertCompletionsMessagesOptions;

  type OpenAICompletionsOptions = openaiCompletionsTypesModule.OpenAICompletionsOptions;
}

export type { openaiCompletionsTypes as default };
