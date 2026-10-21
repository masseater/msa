import apiProviderRegistry from "../api-provider-registry.ts";
import anthropicMessagesLazy from "../api/anthropic-messages.lazy.ts";
import googleGenerativeAiLazy from "../api/google-generative-ai.lazy.ts";
import lazy from "../api/lazy.ts";
import openaiCodexResponsesLazy from "../api/openai-codex-responses.lazy.ts";
import openaiCompletionsLazy from "../api/openai-completions.lazy.ts";
import openaiResponsesLazy from "../api/openai-responses.lazy.ts";
import builtinApiProviders from "../builtin-api-providers.ts";
import legacyApiAliases from "../legacy-api-aliases.ts";
import legacyOpenaiApiAliases from "../legacy-openai-api-aliases.ts";

const apiProvidersKit: {
  readonly anthropicMessagesLazy: typeof anthropicMessagesLazy;
  readonly apiProviderRegistry: typeof apiProviderRegistry;
  readonly builtinApiProviders: typeof builtinApiProviders;
  readonly googleGenerativeAiLazy: typeof googleGenerativeAiLazy;
  readonly lazy: typeof lazy;
  readonly legacyApiAliases: typeof legacyApiAliases;
  readonly legacyOpenaiApiAliases: typeof legacyOpenaiApiAliases;
  readonly openaiCodexResponsesLazy: typeof openaiCodexResponsesLazy;
  readonly openaiCompletionsLazy: typeof openaiCompletionsLazy;
  readonly openaiResponsesLazy: typeof openaiResponsesLazy;
} = {
  anthropicMessagesLazy,
  apiProviderRegistry,
  builtinApiProviders,
  googleGenerativeAiLazy,
  lazy,
  legacyApiAliases,
  legacyOpenaiApiAliases,
  openaiCodexResponsesLazy,
  openaiCompletionsLazy,
  openaiResponsesLazy,
};

export default apiProvidersKit;
