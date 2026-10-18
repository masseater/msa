import type { ThinkingContent } from "../types.ts";
import type { OpenAIReasoningDetail } from "./openai-completions-types.ts";

interface StreamedReasoningState {
  streamedReasoningDetails: OpenAIReasoningDetail[] | undefined;
}

function applyStreamedReasoningDetails(input: {
  state: StreamedReasoningState;
  block: ThinkingContent;
}): void {
  const { state, block } = input;
  if (state.streamedReasoningDetails !== undefined) {
    block.thinkingSignature = JSON.stringify(state.streamedReasoningDetails);
  }
}

export { applyStreamedReasoningDetails, type StreamedReasoningState };
