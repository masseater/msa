import type openaiCodexOptionsTypes from "./api/openai-codex-options.types.ts";
import type openaiCompletionsTypes from "./api/openai-completions.types.ts";
import type openaiResponsesConfigTypes from "./api/openai-responses-config.types.ts";

declare namespace apiOptionsOpenaiTypes {
  interface OpenAIApiOptionsMap {
    "openai-completions": openaiCompletionsTypes.OpenAICompletionsOptions;
    "openai-responses": openaiResponsesConfigTypes.OpenAIResponsesOptions;
    "openai-codex-responses": openaiCodexOptionsTypes.OpenAICodexResponsesOptions;
  }
}

export type { apiOptionsOpenaiTypes as default };
