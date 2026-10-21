import type typesModule from "../types.types.ts";
import type openaiCompletionsStreamReasoningTypes from "./openai-completions-stream-reasoning.types.ts";

function applyStreamedReasoningDetails(input: {
  state: openaiCompletionsStreamReasoningTypes.StreamedReasoningState;
  block: typesModule.ThinkingContent;
}): void {
  const { state, block } = input;
  if (state.streamedReasoningDetails !== undefined) {
    block.thinkingSignature = JSON.stringify(state.streamedReasoningDetails);
  }
}

const openaiCompletionsStreamReasoning = {
  applyStreamedReasoningDetails,
};

export default openaiCompletionsStreamReasoning;
