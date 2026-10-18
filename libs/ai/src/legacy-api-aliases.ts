import { anthropicMessagesApi } from "./api/anthropic-messages.lazy.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import { googleGenerativeAIApi } from "./api/google-generative-ai.lazy.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { SimpleStreamOptions, StreamFunction } from "./types.ts";
import { modelCall } from "./utils/model-call.ts";

const anthropicMessagesStreams = anthropicMessagesApi();
const googleGenerativeAIStreams = googleGenerativeAIApi();

export const streamAnthropic = modelCall(
  anthropicMessagesStreams.stream as StreamFunction<"anthropic-messages", AnthropicOptions>,
);
export const streamSimpleAnthropic = modelCall(
  anthropicMessagesStreams.streamSimple as StreamFunction<
    "anthropic-messages",
    SimpleStreamOptions
  >,
);

export const streamGoogle = modelCall(
  googleGenerativeAIStreams.stream as StreamFunction<"google-generative-ai", GoogleOptions>,
);
export const streamSimpleGoogle = modelCall(
  googleGenerativeAIStreams.streamSimple as StreamFunction<
    "google-generative-ai",
    SimpleStreamOptions
  >,
);
