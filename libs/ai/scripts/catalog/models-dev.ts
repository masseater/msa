import type { Api, Model, ModelCost } from "../../src/types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

function createModelsDevSource(data: modelsDevTypes.ModelsDevCatalog): {
  readonly source: modelsDevTypes.ModelsDevSource;
  readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
} {
  const reasoning: modelsDevTypes.ReasoningOptionsRegistry = new Map();
  return {
    reasoning,
    source: {
      data,
      remember: (provider, id, model) => {
        if (model.reasoning_options !== undefined)
          reasoning.set(`${provider}:${id}`, model.reasoning_options);
      },
    },
  };
}

const orZero = (value: number | undefined): number =>
  value === undefined || Number.isNaN(value) ? 0 : value;

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

function getModelsDevCost(cost: modelsDevTypes.ModelsDevModel["cost"]): ModelCost {
  const base = {
    cacheRead: orZero(cost?.cache_read),
    cacheWrite: cost?.cache_write || 0,
    input: cost?.input || 0,
    output: cost?.output || 0,
  };
  const tiers = cost?.tiers?.flatMap((tier) => {
    const context = tier.tier;
    if (context?.type !== "context" || context.size === undefined) return [];
    return [
      {
        cacheRead: tier.cache_read ?? base.cacheRead,
        cacheWrite: tier.cache_write ?? base.cacheWrite,
        input: tier.input ?? base.input,
        inputTokensAbove: context.size,
        output: tier.output ?? base.output,
      },
    ];
  });

  return tiers !== undefined && tiers.length > 0 ? { ...base, tiers } : base;
}

function modelsDevInput(
  model: Pick<modelsDevTypes.ModelsDevModel, "modalities">,
): ("text" | "image")[] {
  return model.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"];
}

function toolModels(
  provider: modelsDevTypes.ModelsDevProvider | undefined,
): (readonly [string, modelsDevTypes.ModelsDevModel])[] {
  return Object.entries(provider?.models ?? {}).filter(([, model]) => model.tool_call === true);
}

function modelsDevFields({ id, source }: modelsDevTypes.ModelsDevEntry) {
  return {
    contextWindow: source.limit?.context || 4096,
    cost: getModelsDevCost(source.cost),
    id,
    input: modelsDevInput(source),
    maxTokens: source.limit?.output || 4096,
    name: source.name || id,
    reasoning: source.reasoning === true,
  };
}

function modelsDevModel({
  id,
  source,
  api,
  provider,
  baseUrl,
  compat,
  thinkingLevelMap,
  overrides,
}: modelsDevTypes.ModelsDevModelSpec): Model<Api> {
  return {
    ...modelsDevFields({ id, source }),
    api,
    baseUrl,
    provider,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    ...(compat === undefined ? {} : { compat }),
    ...overrides,
  };
}

const modelsDev = {
  createModelsDevSource,
  getModelsDevCost,
  modelsDevFields,
  modelsDevInput,
  modelsDevModel,
  orZero,
  roundCost,
  toolModels,
};

export default modelsDev;
