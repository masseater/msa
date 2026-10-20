import type openaiCodexOptionsTypes from "./api/openai-codex-options.types.ts";
import openaiCodexResponsesLazy from "./api/openai-codex-responses.lazy.ts";
import openaiCompletionsLazy from "./api/openai-completions.lazy.ts";
import type openaiCompletionsTypes from "./api/openai-completions.types.ts";
import type openaiResponsesConfigTypes from "./api/openai-responses-config.types.ts";
import openaiResponsesLazy from "./api/openai-responses.lazy.ts";
import type typesModule from "./types.types.ts";
import modelCallModule from "./utils/model-call.ts";

const { openAICodexResponsesApi } = openaiCodexResponsesLazy;
const { openAICompletionsApi } = openaiCompletionsLazy;
const { openAIResponsesApi } = openaiResponsesLazy;
const { modelCall } = modelCallModule;

const openAICodexResponsesStreams = openAICodexResponsesApi();
const openAICompletionsStreams = openAICompletionsApi();
const openAIResponsesStreams = openAIResponsesApi();

const streamOpenAICodexResponses = modelCall(
  openAICodexResponsesStreams.stream as typesModule.StreamFunction<
    "openai-codex-responses",
    openaiCodexOptionsTypes.OpenAICodexResponsesOptions
  >,
);
const streamSimpleOpenAICodexResponses = modelCall(
  openAICodexResponsesStreams.streamSimple as typesModule.StreamFunction<
    "openai-codex-responses",
    typesModule.SimpleStreamOptions
  >,
);

const streamOpenAICompletions = modelCall(
  openAICompletionsStreams.stream as typesModule.StreamFunction<
    "openai-completions",
    openaiCompletionsTypes.OpenAICompletionsOptions
  >,
);
const streamSimpleOpenAICompletions = modelCall(
  openAICompletionsStreams.streamSimple as typesModule.StreamFunction<
    "openai-completions",
    typesModule.SimpleStreamOptions
  >,
);

const streamOpenAIResponses = modelCall(
  openAIResponsesStreams.stream as typesModule.StreamFunction<
    "openai-responses",
    openaiResponsesConfigTypes.OpenAIResponsesOptions
  >,
);
const streamSimpleOpenAIResponses = modelCall(
  openAIResponsesStreams.streamSimple as typesModule.StreamFunction<
    "openai-responses",
    typesModule.SimpleStreamOptions
  >,
);

const legacyOpenaiApiAliases = {
  streamOpenAICodexResponses,
  streamOpenAICompletions,
  streamOpenAIResponses,
  streamSimpleOpenAICodexResponses,
  streamSimpleOpenAICompletions,
  streamSimpleOpenAIResponses,
};

export default legacyOpenaiApiAliases;
