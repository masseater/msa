import type { OpenAICodexResponsesOptions } from "./api/openai-codex-options.ts";
import { openAICodexResponsesApi } from "./api/openai-codex-responses.lazy.ts";
import { openAICompletionsApi } from "./api/openai-completions.lazy.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses-config.ts";
import { openAIResponsesApi } from "./api/openai-responses.lazy.ts";
import type { SimpleStreamOptions, StreamFunction } from "./types.ts";
import { modelCall } from "./utils/model-call.ts";

const openAICodexResponsesStreams = openAICodexResponsesApi();
const openAICompletionsStreams = openAICompletionsApi();
const openAIResponsesStreams = openAIResponsesApi();

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
