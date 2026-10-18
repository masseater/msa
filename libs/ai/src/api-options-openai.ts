import type { AzureOpenAIResponsesOptions } from "./api/azure-openai-responses-params.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-options.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses-config.ts";

export interface OpenAIApiOptionsMap {
  "openai-completions": OpenAICompletionsOptions;
  "openai-responses": OpenAIResponsesOptions;
  "openai-codex-responses": OpenAICodexResponsesOptions;
  "azure-openai-responses": AzureOpenAIResponsesOptions;
}
