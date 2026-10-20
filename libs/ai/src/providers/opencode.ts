import anthropicMessagesLazy from "../api/anthropic-messages.lazy.ts";
import googleGenerativeAiLazy from "../api/google-generative-ai.lazy.ts";
import openaiCompletionsLazy from "../api/openai-completions.lazy.ts";
import openaiResponsesLazy from "../api/openai-responses.lazy.ts";
import typesafeSystemOneLazy from "../api/typesafe-system-one.lazy.ts";
import helpers from "../auth/helpers.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import opencodeHeaders from "./opencode-headers.ts";
import opencodeModels from "./opencode.models.ts";

const { createProvider } = modelsModule;
const { withOpenCodeSessionHeader } = opencodeHeaders;
const { anthropicMessagesApi } = anthropicMessagesLazy;
const { googleGenerativeAIApi } = googleGenerativeAiLazy;
const { openAICompletionsApi } = openaiCompletionsLazy;
const { openAIResponsesApi } = openaiResponsesLazy;
const { envApiKeyAuth } = helpers;
const { typesafeSystemOneApi } = typesafeSystemOneLazy;
const { OPENCODE_CLASSIFIER_MODELS, OPENCODE_MODELS } = opencodeModels;

type OpenCodeApi =
  | "anthropic-messages"
  | "google-generative-ai"
  | "openai-completions"
  | "openai-responses";

function opencodeProvider(): modelsTypes.Provider<OpenCodeApi> {
  return createProvider<OpenCodeApi>({
    api: {
      "anthropic-messages": withOpenCodeSessionHeader(anthropicMessagesApi()),
      "google-generative-ai": withOpenCodeSessionHeader(googleGenerativeAIApi()),
      "openai-completions": withOpenCodeSessionHeader(openAICompletionsApi()),
      "openai-responses": withOpenCodeSessionHeader(openAIResponsesApi()),
    },
    auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
    classifiers: { "typesafe-system-one": typesafeSystemOneApi() },
    id: "opencode",
    models: [...Object.values(OPENCODE_MODELS), ...Object.values(OPENCODE_CLASSIFIER_MODELS)],
    name: "OpenCode Zen",
  });
}

const opencode = {
  opencodeProvider,
};

export default opencode;
