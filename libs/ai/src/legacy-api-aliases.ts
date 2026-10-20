import anthropicMessagesLazy from "./api/anthropic-messages.lazy.ts";
import type anthropicMessagesTypes from "./api/anthropic-messages.types.ts";
import googleGenerativeAiLazy from "./api/google-generative-ai.lazy.ts";
import type googleGenerativeAiTypes from "./api/google-generative-ai.types.ts";
import type typesModule from "./types.types.ts";
import modelCallModule from "./utils/model-call.ts";

const { anthropicMessagesApi } = anthropicMessagesLazy;
const { googleGenerativeAIApi } = googleGenerativeAiLazy;
const { modelCall } = modelCallModule;

const anthropicMessagesStreams = anthropicMessagesApi();
const googleGenerativeAIStreams = googleGenerativeAIApi();

const streamAnthropic = modelCall(
  anthropicMessagesStreams.stream as typesModule.StreamFunction<
    "anthropic-messages",
    anthropicMessagesTypes.AnthropicOptions
  >,
);
const streamSimpleAnthropic = modelCall(
  anthropicMessagesStreams.streamSimple as typesModule.StreamFunction<
    "anthropic-messages",
    typesModule.SimpleStreamOptions
  >,
);

const streamGoogle = modelCall(
  googleGenerativeAIStreams.stream as typesModule.StreamFunction<
    "google-generative-ai",
    googleGenerativeAiTypes.GoogleOptions
  >,
);
const streamSimpleGoogle = modelCall(
  googleGenerativeAIStreams.streamSimple as typesModule.StreamFunction<
    "google-generative-ai",
    typesModule.SimpleStreamOptions
  >,
);

const legacyApiAliases = {
  streamAnthropic,
  streamGoogle,
  streamSimpleAnthropic,
  streamSimpleGoogle,
};

export default legacyApiAliases;
