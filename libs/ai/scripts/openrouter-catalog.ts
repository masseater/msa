import { Function } from "effect";

import { type OpenRouterModel, openRouterCost } from "../src/providers/openrouter-api.ts";
import type { ClassifierModel, ImageModel, Model } from "../src/types.ts";
import {
  getOpenRouterThinkingLevelMap,
  type OpenRouterReasoningMetadata,
} from "./openrouter-reasoning-options.ts";

export interface OpenRouterModelListItem extends OpenRouterModel {
  name: string;
  supported_parameters?: string[];
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  reasoning?: OpenRouterReasoningMetadata;
}

export interface OpenRouterCatalog {
  chat: Model<"anthropic-messages" | "openai-completions">[];
  images: ImageModel<"openrouter-images">[];
  classifiers: ClassifierModel<"typesafe-system-one">[];
}

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

function openRouterChatModel(model: OpenRouterModelListItem): OpenRouterCatalog["chat"][number] {
  const thinkingLevelMap = getOpenRouterThinkingLevelMap(model.reasoning);
  const useAnthropicMessages = model.id.startsWith("anthropic/") && !model.id.endsWith(":batch");
  return {
    type: "chat",
    id: model.id,
    name: model.name,
    api: useAnthropicMessages ? "anthropic-messages" : "openai-completions",
    baseUrl: useAnthropicMessages ? "https://openrouter.ai/api" : "https://openrouter.ai/api/v1",
    provider: "openrouter",
    reasoning: model.supported_parameters?.includes("reasoning") || false,
    ...(thinkingLevelMap && { thinkingLevelMap }),
    input: model.architecture?.modality?.includes("image") === true ? ["text", "image"] : ["text"],
    cost: openRouterCost(model.pricing),
    contextWindow: model.top_provider?.context_length || model.context_length || 4096,
    maxTokens: model.top_provider?.max_completion_tokens || 4096,
  };
}

function openRouterChatModels(
  listed: readonly OpenRouterModelListItem[],
): OpenRouterCatalog["chat"] {
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
  imageListed: readonly OpenRouterModelListItem[],
): OpenRouterCatalog["images"] {
  return firstById(
    imageListed.flatMap((model): OpenRouterCatalog["images"] => {
      const output = modalities(model.architecture?.output_modalities);
      if (!output.includes("image")) return [];
      return [
        {
          type: "image",
          id: model.id,
          name: model.name,
          api: "openrouter-images",
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          input: openRouterInput(model.architecture?.input_modalities),
          output,
          cost: openRouterCost(model.pricing),
        },
      ];
    }),
  );
}

function openRouterClassifierModels(
  decisionListed: readonly OpenRouterModelListItem[],
): OpenRouterCatalog["classifiers"] {
  return firstById(
    decisionListed.filter(
      (model) => model.architecture?.output_modalities?.includes("decisions") === true,
    ),
  ).map((model) => ({
    type: "classifier",
    id: model.id,
    name: model.name,
    api: "typesafe-system-one",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    input: openRouterInput(model.architecture?.input_modalities),
    cost: openRouterCost(model.pricing),
    contextWindow: model.top_provider?.context_length || model.context_length || 4096,
  }));
}

export const buildOpenRouterCatalog: {
  (
    imageListed: readonly OpenRouterModelListItem[],
    decisionListed: readonly OpenRouterModelListItem[],
  ): (listed: readonly OpenRouterModelListItem[]) => OpenRouterCatalog;
  (
    listed: readonly OpenRouterModelListItem[],
    imageListed: readonly OpenRouterModelListItem[],
    decisionListed: readonly OpenRouterModelListItem[],
  ): OpenRouterCatalog;
} = Function.dual(
  3,
  (
    listed: readonly OpenRouterModelListItem[],
    imageListed: readonly OpenRouterModelListItem[],
    decisionListed: readonly OpenRouterModelListItem[],
  ): OpenRouterCatalog => ({
    chat: openRouterChatModels(listed),
    images: openRouterImageModels(imageListed),
    classifiers: openRouterClassifierModels(decisionListed),
  }),
);
