import llamaCppClassifyLazy from "@msa/ai/api/llama-cpp-classify.lazy";
import typesafeSystemOneLazy from "@msa/ai/api/typesafe-system-one.lazy";
import compatModule from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";

import clientModule from "./client.ts";
import llamaModels from "./llama-models.ts";
import providerAuth from "./provider-auth.ts";
import LlamaCatalog from "./provider-catalog.ts";
import type providerTypes from "./provider.types.ts";

const { llamaCppClassifyApi } = llamaCppClassifyLazy;
const { typesafeSystemOneApi } = typesafeSystemOneLazy;
const { stream, streamSimple } = compatModule;
const { llamaInferenceUrl } = clientModule;
const { DEFAULT_LLAMA_SERVER_URL, LLAMA_PROVIDER_ID } = llamaModels;
const { llamaApiKeyAuth } = providerAuth;

function createLlamaProvider(): providerTypes.LlamaProviderController {
  const catalog = new LlamaCatalog();
  const fallbackClassifier = llamaCppClassifyApi();
  const decisionClassifier = typesafeSystemOneApi();

  const provider: aiTypes.Provider<"openai-completions"> = {
    auth: { apiKey: llamaApiKeyAuth },
    baseUrl: llamaInferenceUrl(DEFAULT_LLAMA_SERVER_URL),
    classify: (model, context, options) =>
      (model.api === "typesafe-system-one" ? decisionClassifier : fallbackClassifier).classify(
        model,
        context,
        options,
      ),
    getAllModels: () => [...catalog.models, ...catalog.classifiers],
    getModels: () => catalog.models,
    id: LLAMA_PROVIDER_ID,
    name: "llama.cpp",
    refreshModels: (context) => catalog.refresh(context),
    stream: (model, context, options) =>
      stream(model, context, options as aiTypes.ProviderStreamOptions | undefined),
    streamSimple: (model, context, options) => streamSimple(model, context, options),
  };

  return { provider, setCatalog: catalog.setCatalog };
}

const provider = {
  DEFAULT_LLAMA_SERVER_URL,
  LLAMA_PROVIDER_ID,
  createLlamaProvider,
};

export default provider;
