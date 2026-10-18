import type { Api, Model, ModelCost } from "../../src/types.ts";
import type { ModelsDevReasoningOption } from "../models-dev-reasoning-options.ts";

export interface ModelsDevModel {
  id: string;
  name: string;
  tool_call?: boolean;
  structured_output?: boolean;
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
  status?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: {
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tier?: {
        type?: string;
        size?: number;
      };
    }[];
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  provider?: {
    npm?: string;
  };
}

export interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

export interface ModelsDevMetadata {
  id: string;
  type?: string;
  name: string;
  limit?: { context?: number };
  modalities?: { input?: string[] };
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

export type ThinkingLevelMap = NonNullable<Model<any>["thinkingLevelMap"]>;

export type ReasoningOptionsRegistry = Map<string, ModelsDevReasoningOption[]>;

export interface ModelsDevSource {
  readonly data: ModelsDevCatalog;
  readonly strict: boolean;
  readonly remember: (provider: string, id: string, source: ModelsDevModel) => void;
}

export function createModelsDevSource({
  data,
  strict,
}: {
  readonly data: ModelsDevCatalog;
  readonly strict: boolean;
}): { readonly source: ModelsDevSource; readonly reasoning: ReasoningOptionsRegistry } {
  const reasoning: ReasoningOptionsRegistry = new Map();
  return {
    reasoning,
    source: {
      data,
      strict,
      remember: (provider, id, model) => {
        if (model.reasoning_options !== undefined)
          reasoning.set(`${provider}:${id}`, model.reasoning_options);
      },
    },
  };
}

export const orZero = (value: number | undefined): number =>
  value === undefined || Number.isNaN(value) ? 0 : value;

export function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

export function getModelsDevCost(cost: ModelsDevModel["cost"]): ModelCost {
  const base = {
    input: cost?.input || 0,
    output: cost?.output || 0,
    cacheRead: orZero(cost?.cache_read),
    cacheWrite: cost?.cache_write || 0,
  };
  const tiers = cost?.tiers?.flatMap((tier) => {
    const context = tier.tier;
    if (context?.type !== "context" || context.size === undefined) return [];
    return [
      {
        inputTokensAbove: context.size,
        input: tier.input ?? base.input,
        output: tier.output ?? base.output,
        cacheRead: tier.cache_read ?? base.cacheRead,
        cacheWrite: tier.cache_write ?? base.cacheWrite,
      },
    ];
  });

  return tiers !== undefined && tiers.length > 0 ? { ...base, tiers } : base;
}

export function modelsDevInput(model: Pick<ModelsDevModel, "modalities">): ("text" | "image")[] {
  return model.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"];
}

export function toolModels(
  provider: ModelsDevProvider | undefined,
): (readonly [string, ModelsDevModel])[] {
  return Object.entries(provider?.models ?? {}).filter(([, model]) => model.tool_call === true);
}

export interface ModelsDevEntry {
  readonly id: string;
  readonly source: ModelsDevModel;
}

export function modelsDevFields({ id, source }: ModelsDevEntry) {
  return {
    id,
    name: source.name || id,
    reasoning: source.reasoning === true,
    input: modelsDevInput(source),
    cost: getModelsDevCost(source.cost),
    contextWindow: source.limit?.context || 4096,
    maxTokens: source.limit?.output || 4096,
  };
}

export interface ModelsDevModelSpec extends ModelsDevEntry {
  readonly api: Api;
  readonly provider: string;
  readonly baseUrl: string;
  readonly compat?: Model<Api>["compat"];
  readonly thinkingLevelMap?: ThinkingLevelMap | undefined;
  readonly overrides?: Partial<Pick<Model<Api>, "input" | "cost" | "reasoning" | "headers">>;
}

export function modelsDevModel({
  id,
  source,
  api,
  provider,
  baseUrl,
  compat,
  thinkingLevelMap,
  overrides,
}: ModelsDevModelSpec): Model<Api> {
  return {
    ...modelsDevFields({ id, source }),
    api,
    provider,
    baseUrl,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    ...(compat === undefined ? {} : { compat }),
    ...overrides,
  };
}
