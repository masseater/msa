import anthropicMessagesLazy from "../api/anthropic-messages.lazy.ts";
import googleGenerativeAiLazy from "../api/google-generative-ai.lazy.ts";
import openaiCompletionsLazy from "../api/openai-completions.lazy.ts";
import openaiResponsesLazy from "../api/openai-responses.lazy.ts";
import helpers from "../auth/helpers.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import opencodeGoModels from "./opencode-go.models.ts";
import opencodeHeaders from "./opencode-headers.ts";

const { createProvider } = modelsModule;
const { withOpenCodeSessionHeader } = opencodeHeaders;
const { anthropicMessagesApi } = anthropicMessagesLazy;
const { googleGenerativeAIApi } = googleGenerativeAiLazy;
const { openAICompletionsApi } = openaiCompletionsLazy;
const { openAIResponsesApi } = openaiResponsesLazy;
const { envApiKeyAuth } = helpers;
const { OPENCODE_GO_MODELS } = opencodeGoModels;

type OpenCodeGoApi =
  | "anthropic-messages"
  | "google-generative-ai"
  | "openai-completions"
  | "openai-responses";

function opencodeGoProvider(): modelsTypes.Provider<OpenCodeGoApi> {
  return createProvider<OpenCodeGoApi>({
    api: {
      "anthropic-messages": withOpenCodeSessionHeader(anthropicMessagesApi()),
      "google-generative-ai": withOpenCodeSessionHeader(googleGenerativeAIApi()),
      "openai-completions": withOpenCodeSessionHeader(openAICompletionsApi()),
      "openai-responses": withOpenCodeSessionHeader(openAIResponsesApi()),
    },
    auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
    id: "opencode-go",
    models: Object.values(OPENCODE_GO_MODELS),
    name: "OpenCode Go",
  });
}

const opencodeGo = {
  opencodeGoProvider,
};

export default opencodeGo;
