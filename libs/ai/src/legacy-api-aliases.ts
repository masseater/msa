import { anthropicMessagesApi } from "./api/anthropic-messages.lazy.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import { azureOpenAIResponsesApi } from "./api/azure-openai-responses.lazy.ts";
import type { AzureOpenAIResponsesOptions } from "./api/azure-openai-responses.ts";
import { googleGenerativeAIApi } from "./api/google-generative-ai.lazy.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import { googleVertexApi } from "./api/google-vertex.lazy.ts";
import type { GoogleVertexOptions } from "./api/google-vertex.ts";
import { mistralConversationsApi } from "./api/mistral-conversations.lazy.ts";
import type { MistralOptions } from "./api/mistral-conversations.ts";
import { openAICodexResponsesApi } from "./api/openai-codex-responses.lazy.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import { openAICompletionsApi } from "./api/openai-completions.lazy.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import { openAIResponsesApi } from "./api/openai-responses.lazy.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";
import type { SimpleStreamOptions, StreamFunction } from "./types.ts";
import { modelCall } from "./utils/model-call.ts";

const anthropicMessagesStreams = anthropicMessagesApi();
const azureOpenAIResponsesStreams = azureOpenAIResponsesApi();
const googleGenerativeAIStreams = googleGenerativeAIApi();
const googleVertexStreams = googleVertexApi();
const mistralConversationsStreams = mistralConversationsApi();
const openAICodexResponsesStreams = openAICodexResponsesApi();
const openAICompletionsStreams = openAICompletionsApi();
const openAIResponsesStreams = openAIResponsesApi();

export const streamAnthropic = modelCall(
  anthropicMessagesStreams.stream as StreamFunction<"anthropic-messages", AnthropicOptions>,
);
export const streamSimpleAnthropic = modelCall(
  anthropicMessagesStreams.streamSimple as StreamFunction<
    "anthropic-messages",
    SimpleStreamOptions
  >,
);

export const streamAzureOpenAIResponses = modelCall(
  azureOpenAIResponsesStreams.stream as StreamFunction<
    "azure-openai-responses",
    AzureOpenAIResponsesOptions
  >,
);
export const streamSimpleAzureOpenAIResponses = modelCall(
  azureOpenAIResponsesStreams.streamSimple as StreamFunction<
    "azure-openai-responses",
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

export const streamOpenAICodexResponses = modelCall(
  openAICodexResponsesStreams.stream as StreamFunction<
    "openai-codex-responses",
    OpenAICodexResponsesOptions
  >,
);
export const streamSimpleOpenAICodexResponses = modelCall(
  openAICodexResponsesStreams.streamSimple as StreamFunction<
    "openai-codex-responses",
    SimpleStreamOptions
  >,
);

export const streamOpenAICompletions = modelCall(
  openAICompletionsStreams.stream as StreamFunction<"openai-completions", OpenAICompletionsOptions>,
);
export const streamSimpleOpenAICompletions = modelCall(
  openAICompletionsStreams.streamSimple as StreamFunction<
    "openai-completions",
    SimpleStreamOptions
  >,
);

export const streamOpenAIResponses = modelCall(
  openAIResponsesStreams.stream as StreamFunction<"openai-responses", OpenAIResponsesOptions>,
);
export const streamSimpleOpenAIResponses = modelCall(
  openAIResponsesStreams.streamSimple as StreamFunction<"openai-responses", SimpleStreamOptions>,
);
