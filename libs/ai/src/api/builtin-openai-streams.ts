import type typesModule from "../types.types.ts";
import openaiCodexResponsesLazy from "./openai-codex-responses.lazy.ts";
import openaiCompletionsLazy from "./openai-completions.lazy.ts";
import openaiResponsesLazy from "./openai-responses.lazy.ts";

const { openAICompletionsApi } = openaiCompletionsLazy;
const { openAIResponsesApi } = openaiResponsesLazy;
const { openAICodexResponsesApi } = openaiCodexResponsesLazy;

function builtinOpenAIStreams(): [typesModule.Api, typesModule.ProviderStreams][] {
  return [
    ["openai-completions", openAICompletionsApi()],
    ["openai-responses", openAIResponsesApi()],
    ["openai-codex-responses", openAICodexResponsesApi()],
  ];
}

const builtinOpenaiStreams = {
  builtinOpenAIStreams,
};

export default builtinOpenaiStreams;
