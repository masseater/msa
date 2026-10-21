import openaiDecisionsLazy from "../api/openai-decisions.lazy.ts";
import openaiResponsesLazy from "../api/openai-responses.lazy.ts";
import helpers from "../auth/helpers.ts";
import loadModule from "../auth/oauth/load.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import type typesModule from "../types.types.ts";
import openaiModels from "./openai.models.ts";

const { createProvider, isModelType } = modelsModule;
const { openAIResponsesApi } = openaiResponsesLazy;
const { envApiKeyAuth, lazyOAuth } = helpers;
const { loadOpenAIChatGPTOAuth } = loadModule;
const { openAIDecisionsApi } = openaiDecisionsLazy;
const { OPENAI_CLASSIFIER_MODELS, OPENAI_MODELS } = openaiModels;

function openaiProvider(): modelsTypes.Provider<"openai-responses"> {
  return createProvider<"openai-responses">({
    api: openAIResponsesApi(),
    auth: {
      apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]),
      oauth: lazyOAuth({
        isSubscription: true,
        load: loadOpenAIChatGPTOAuth,
        loginLabel: "Sign in with ChatGPT",
        name: "OpenAI (ChatGPT subscription)",
      }),
    },
    baseUrl: "https://api.openai.com/v1",
    classifiers: {
      "openai-decisions": openAIDecisionsApi(),
    },
    filterAllModels: (models, credential) =>
      credential?.type === "oauth"
        ? models.filter((model) => !isModelType(model, "classifier"))
        : models,
    id: "openai",
    models: [
      ...Object.values(OPENAI_MODELS),
      ...Object.values<typesModule.ClassifierModel<"openai-decisions">>(OPENAI_CLASSIFIER_MODELS),
    ],
    name: "OpenAI",
  });
}

const openai = {
  openaiProvider,
};

export default openai;
