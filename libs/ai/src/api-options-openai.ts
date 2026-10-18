import type { AzureOpenAIResponsesOptions } from "./api/azure-openai-responses.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";

export interface OpenAIApiOptionsMap {
  "openai-completions": OpenAICompletionsOptions;
  "openai-responses": OpenAIResponsesOptions;
  "openai-codex-responses": OpenAICodexResponsesOptions;
  "azure-openai-responses": AzureOpenAIResponsesOptions;
}
