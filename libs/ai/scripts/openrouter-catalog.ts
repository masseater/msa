import { Function } from "effect";

import openrouterApi from "../src/providers/openrouter-api.ts";
import type openrouterCatalogTypes from "./openrouter-catalog.types.ts";
import getOpenRouterThinkingLevelMap from "./openrouter-reasoning-options.ts";

const { openRouterCost } = openrouterApi;

function modalities(values: string[] | undefined): ("text" | "image")[] {
  return Array.from(
    new Set(
      (values ?? []).filter(
        (value): value is "text" | "image" => value === "text" || value === "image",
      ),
    ),
  );
}

function openRouterInput(values: string[] | undefined): ("text" | "image")[] {
  const input = modalities(values);
  return input.length > 0 ? input : ["text"];
}

function openRouterChatModel(
  model: openrouterCatalogTypes.OpenRouterModelListItem,
): openrouterCatalogTypes.OpenRouterCatalog["chat"][number] {
  const thinkingLevelMap = getOpenRouterThinkingLevelMap(model.reasoning);
  const useAnthropicMessages = model.id.startsWith("anthropic/") && !model.id.endsWith(":batch");
  return {
    api: useAnthropicMessages ? "anthropic-messages" : "openai-completions",
    baseUrl: useAnthropicMessages ? "https://openrouter.ai/api" : "https://openrouter.ai/api/v1",
    id: model.id,
    name: model.name,
    provider: "openrouter",
    reasoning: model.supported_parameters?.includes("reasoning") || false,
    type: "chat",
    ...(thinkingLevelMap && { thinkingLevelMap }),
    contextWindow: model.top_provider?.context_length || model.context_length || 4096,
    cost: openRouterCost(model.pricing),
    input: model.architecture?.modality?.includes("image") === true ? ["text", "image"] : ["text"],
    maxTokens: model.top_provider?.max_completion_tokens || 4096,
  };
}

function openRouterChatModels(
  listed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
): openrouterCatalogTypes.OpenRouterCatalog["chat"] {
  return listed
    .filter((model) => model.supported_parameters?.includes("tools") === true)
    .map(openRouterChatModel);
}

function firstById<A extends { readonly id: string }>(models: readonly A[]): A[] {
  return models.filter(
    (model, index) => models.findIndex((entry) => entry.id === model.id) === index,
  );
}

function openRouterImageModels(
  imageListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
): openrouterCatalogTypes.OpenRouterCatalog["images"] {
  return firstById(
    imageListed.flatMap((model): openrouterCatalogTypes.OpenRouterCatalog["images"] => {
      const output = modalities(model.architecture?.output_modalities);
      if (!output.includes("image")) return [];
      return [
        {
          api: "openrouter-images",
          baseUrl: "https://openrouter.ai/api/v1",
          cost: openRouterCost(model.pricing),
          id: model.id,
          input: openRouterInput(model.architecture?.input_modalities),
          name: model.name,
          output,
          provider: "openrouter",
          type: "image",
        },
      ];
    }),
  );
}

function openRouterClassifierModels(
  decisionListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
): openrouterCatalogTypes.OpenRouterCatalog["classifiers"] {
  return firstById(
    decisionListed.filter(
      (model) => model.architecture?.output_modalities?.includes("decisions") === true,
    ),
  ).map((model) => ({
    api: "typesafe-system-one",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: model.top_provider?.context_length || model.context_length || 4096,
    cost: openRouterCost(model.pricing),
    id: model.id,
    input: openRouterInput(model.architecture?.input_modalities),
    name: model.name,
    provider: "openrouter",
    type: "classifier",
  }));
}

const buildOpenRouterCatalog: {
  (
    imageListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
    decisionListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
  ): (
    listed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
  ) => openrouterCatalogTypes.OpenRouterCatalog;
  (
    listed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
    imageListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
    decisionListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
  ): openrouterCatalogTypes.OpenRouterCatalog;
} = Function.dual(
  3,
  (
    listed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
    imageListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
    decisionListed: readonly openrouterCatalogTypes.OpenRouterModelListItem[],
  ): openrouterCatalogTypes.OpenRouterCatalog => ({
    chat: openRouterChatModels(listed),
    classifiers: openRouterClassifierModels(decisionListed),
    images: openRouterImageModels(imageListed),
  }),
);

export default buildOpenRouterCatalog;
