import nodeLlamaCppClassifyLazy from "../api/node-llama-cpp-classify.lazy.ts";
import type nodeLlamaCppClassifyTypes from "../api/node-llama-cpp-classify.types.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import type typesModule from "../types.types.ts";

const { createProvider } = modelsModule;
const { nodeLlamaCppClassifyApi } = nodeLlamaCppClassifyLazy;

const LOCAL_PROVIDER_ID = "local";

const LIQUID_D1: typesModule.ClassifierModel<"node-llama-cpp-classify"> = {
  api: "node-llama-cpp-classify",
  baseUrl: "hf:LiquidAI/d1-3B-GGUF/d1-3B-Q4_K_M.gguf",
  contextWindow: 16384,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "liquid-d1-3b",
  input: ["text"],
  name: "Liquid D1 3B",
  provider: LOCAL_PROVIDER_ID,
  type: "classifier",
};

function localProvider(
  config: nodeLlamaCppClassifyTypes.LocalClassifierConfig,
  models: readonly typesModule.ClassifierModel<"node-llama-cpp-classify">[] = [LIQUID_D1],
): modelsTypes.Provider {
  return createProvider({
    auth: { apiKey: { name: "Local", resolve: () => Promise.resolve({ auth: {} }) } },
    classifiers: { "node-llama-cpp-classify": nodeLlamaCppClassifyApi(config) },
    id: LOCAL_PROVIDER_ID,
    models,
    name: "Local",
  });
}

const local = {
  LIQUID_D1,
  LOCAL_PROVIDER_ID,
  localProvider,
};

export default local;
