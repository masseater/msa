import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

declare namespace openaiCompletionsStreamReasoningTypes {
  interface StreamedReasoningState {
    streamedReasoningDetails: openaiCompletionsTypesModule.OpenAIReasoningDetail[] | undefined;
  }
}

export type { openaiCompletionsStreamReasoningTypes as default };
