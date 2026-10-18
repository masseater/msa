import type { Api, Model, ModelCost } from "../../src/types.ts";
import {
  type ModelsDevModel,
  type ModelsDevSource,
  getModelsDevCost,
  modelsDevInput,
  orZero,
  toolModels,
} from "./models-dev.ts";
import { getGoogleThinkingLevelMap } from "./thinking-maps.ts";

const VERTEX_BASE_URL = "https://{location}-aiplatform.googleapis.com";

function latestAliasSource(
  models: Record<string, ModelsDevModel>,
  modelId: string,
  model: ModelsDevModel,
): ModelsDevModel {
  if (modelId === "gemini-flash-latest") return models["gemini-3.5-flash"] ?? model;
  if (modelId === "gemini-flash-lite-latest") return models["gemini-3.1-flash-lite"] ?? model;
  return model;
}

interface GeminiModelSpec {
  readonly modelId: string;
  readonly model: ModelsDevModel;
  readonly source: ModelsDevModel;
  readonly api: "google-generative-ai" | "google-vertex";
  readonly provider: string;
  readonly baseUrl: string;
  readonly cost: ModelCost;
}

function geminiModel({ modelId, model, source, ...route }: GeminiModelSpec): Model<Api> {
  const thinkingLevelMap = getGoogleThinkingLevelMap(modelId, source.reasoning_options ?? []);
  return {
    id: modelId,
    name: model.name || modelId,
    ...route,
    reasoning: source.reasoning === true,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    input: modelsDevInput(source),
    contextWindow: source.limit?.context || 4096,
    maxTokens: source.limit?.output || 4096,
  };
}

function googleGenerativeModels({ data }: ModelsDevSource): Model<Api>[] {
  const generativeModels = data["google"]?.models ?? {};
  return toolModels(data["google"]).map(([modelId, model]) => {
    const source = latestAliasSource(generativeModels, modelId, model);
    return geminiModel({
      modelId,
      model,
      source,
      api: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      cost: getModelsDevCost(source.cost),
    });
  });
}

function googleVertexModels({ data }: ModelsDevSource): Model<Api>[] {
  const vertexModels = data["google-vertex"]?.models ?? {};
  return toolModels(data["google-vertex"])
    .filter(
      ([modelId]) => modelId.startsWith("gemini-") && modelId !== "gemini-3.1-flash-lite-preview",
    )
    .map(([modelId, model]) => {
      const source = latestAliasSource(vertexModels, modelId, model);
      return geminiModel({
        modelId,
        model,
        source,
        api: "google-vertex",
        provider: "google-vertex",
        baseUrl: VERTEX_BASE_URL,
        cost: {
          input: source.cost?.input || 0,
          output: source.cost?.output || 0,
          cacheRead: modelId === "gemini-2.5-flash" ? 0.03 : orZero(source.cost?.cache_read),
          cacheWrite: 0,
        },
      });
    });
}

export function googleModels(source: ModelsDevSource): Model<Api>[] {
  return [...googleGenerativeModels(source), ...googleVertexModels(source)];
}
