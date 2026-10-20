import apiProviderRegistry from "./api-provider-registry.ts";
import anthropicMessagesLazy from "./api/anthropic-messages.lazy.ts";
import googleGenerativeAiLazy from "./api/google-generative-ai.lazy.ts";
import lazy from "./api/lazy.ts";
import openaiCodexResponsesLazy from "./api/openai-codex-responses.lazy.ts";
import openaiCompletionsLazy from "./api/openai-completions.lazy.ts";
import openaiResponsesLazy from "./api/openai-responses.lazy.ts";
import context from "./auth/context.ts";
import credentialStore from "./auth/credential-store.ts";

const compatKitPart1 = {
  anthropicMessagesLazy,
  apiProviderRegistry,
  context,
  credentialStore,
  googleGenerativeAiLazy,
  lazy,
  openaiCodexResponsesLazy,
  openaiCompletionsLazy,
  openaiResponsesLazy,
};

export default compatKitPart1;
