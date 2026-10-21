import openaiCodexResponsesLazy from "../api/openai-codex-responses.lazy.ts";
import helpers from "../auth/helpers.ts";
import loadModule from "../auth/oauth/load.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import openaiCodexModels from "./openai-codex.models.ts";

const { createProvider } = modelsModule;
const { openAICodexResponsesApi } = openaiCodexResponsesLazy;
const { lazyOAuth } = helpers;
const { loadOpenAICodexOAuth } = loadModule;
const { OPENAI_CODEX_MODELS } = openaiCodexModels;

function openaiCodexProvider(): modelsTypes.Provider<"openai-codex-responses"> {
  return createProvider({
    api: openAICodexResponsesApi(),
    auth: {
      oauth: lazyOAuth({
        isSubscription: true,
        load: loadOpenAICodexOAuth,
        name: "OpenAI (ChatGPT Plus/Pro)",
      }),
    },
    baseUrl: "https://chatgpt.com/backend-api",
    id: "openai-codex",
    models: Object.values(OPENAI_CODEX_MODELS),
    name: "OpenAI Codex (legacy)",
  });
}

const openaiCodex = {
  openaiCodexProvider,
};

export default openaiCodex;
