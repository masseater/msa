import { anthropicMessagesApi } from "./api/anthropic-messages.lazy.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import { googleGenerativeAIApi } from "./api/google-generative-ai.lazy.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import { googleVertexApi } from "./api/google-vertex.lazy.ts";
import type { GoogleVertexOptions } from "./api/google-vertex.ts";
import { mistralConversationsApi } from "./api/mistral-conversations.lazy.ts";
import type { MistralOptions } from "./api/mistral-conversations.ts";
import type { SimpleStreamOptions, StreamFunction } from "./types.ts";
import { modelCall } from "./utils/model-call.ts";

const anthropicMessagesStreams = anthropicMessagesApi();
const googleGenerativeAIStreams = googleGenerativeAIApi();
const googleVertexStreams = googleVertexApi();
const mistralConversationsStreams = mistralConversationsApi();

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

export const streamGoogleVertex = modelCall(
  googleVertexStreams.stream as StreamFunction<"google-vertex", GoogleVertexOptions>,
);
export const streamSimpleGoogleVertex = modelCall(
  googleVertexStreams.streamSimple as StreamFunction<"google-vertex", SimpleStreamOptions>,
);

export const streamMistral = modelCall(
  mistralConversationsStreams.stream as StreamFunction<"mistral-conversations", MistralOptions>,
);
export const streamSimpleMistral = modelCall(
  mistralConversationsStreams.streamSimple as StreamFunction<
    "mistral-conversations",
    SimpleStreamOptions
  >,
);
