import type { Api, ProviderStreams } from "../types.ts";
import { azureOpenAIResponsesApi } from "./azure-openai-responses.lazy.ts";
import { openAICodexResponsesApi } from "./openai-codex-responses.lazy.ts";
import { openAICompletionsApi } from "./openai-completions.lazy.ts";
import { openAIResponsesApi } from "./openai-responses.lazy.ts";

export function builtinOpenAIStreams(): [Api, ProviderStreams][] {
  return [
    ["openai-completions", openAICompletionsApi()],
    ["openai-responses", openAIResponsesApi()],
    ["openai-codex-responses", openAICodexResponsesApi()],
    ["azure-openai-responses", azureOpenAIResponsesApi()],
  ];
}
