import anthropicMessagesLazy from "../api/anthropic-messages.lazy.ts";
import openaiCompletionsLazy from "../api/openai-completions.lazy.ts";
import openrouterImagesLazy from "../api/openrouter-images.lazy.ts";
import typesafeSystemOneLazy from "../api/typesafe-system-one.lazy.ts";
import helpers from "../auth/helpers.ts";
import loadModule from "../auth/oauth/load.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import openrouterApi from "./openrouter-api.ts";
import openrouterModels from "./openrouter.models.ts";

const { createProvider } = modelsModule;
const { anthropicMessagesApi } = anthropicMessagesLazy;
const { openAICompletionsApi } = openaiCompletionsLazy;
const { envApiKeyAuth, lazyOAuth } = helpers;
const { loadOpenRouterOAuth } = loadModule;
const { OPENROUTER_BASE_URL } = openrouterApi;
const { typesafeSystemOneApi } = typesafeSystemOneLazy;
const { openrouterImagesApi } = openrouterImagesLazy;
const { OPENROUTER_CLASSIFIER_MODELS, OPENROUTER_IMAGE_MODELS, OPENROUTER_MODELS } =
  openrouterModels;
function openrouterProvider(): modelsTypes.Provider<"anthropic-messages" | "openai-completions"> {
  return createProvider<"anthropic-messages" | "openai-completions">({
    api: {
      "anthropic-messages": anthropicMessagesApi(),
      "openai-completions": openAICompletionsApi(),
    },
    auth: {
      apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]),
      oauth: lazyOAuth({
        load: loadOpenRouterOAuth,
        loginLabel: "Sign in with OpenRouter",
        name: "OpenRouter OAuth",
      }),
    },
    baseUrl: OPENROUTER_BASE_URL,
    classifiers: { "typesafe-system-one": typesafeSystemOneApi() },
    id: "openrouter",
    images: { "openrouter-images": openrouterImagesApi() },
    models: [
      ...Object.values(OPENROUTER_MODELS),
      ...Object.values(OPENROUTER_IMAGE_MODELS),
      ...Object.values(OPENROUTER_CLASSIFIER_MODELS),
    ],
    name: "OpenRouter",
  });
}

const openrouter = {
  openrouterProvider,
};

export default openrouter;
