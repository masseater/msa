import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import { assertExactModelIds } from "../model-data.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import {
  type ModelsDevModel,
  modelsDevFields,
  modelsDevModel,
  type ModelsDevSource,
  toolModels,
} from "./models-dev.ts";

const MINIMAX_VARIANTS = [
  { key: "minimax", provider: "minimax", baseUrl: "https://api.minimax.io/anthropic" },
  { key: "minimax-cn", provider: "minimax-cn", baseUrl: "https://api.minimaxi.com/anthropic" },
] as const;

export function minimaxModels({ data, remember }: ModelsDevSource): Model<Api>[] {
  return MINIMAX_VARIANTS.flatMap(({ key, provider, baseUrl }) =>
    toolModels(data[key]).map(([id, source]): Model<Api> => {
      remember(provider, id, source);
      return modelsDevModel({ id, source, api: "anthropic-messages", provider, baseUrl });
    }),
  );
}

const XIAOMI_COMPAT: OpenAICompletionsCompat = {
  supportsReasoningEffort: false,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
};
const XIAOMI_THINKING_LEVEL_MAP = {
  off: "off",
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: null,
} as const;
const XIAOMI_VARIANTS = [
  { source: "xiaomi", provider: "xiaomi", baseUrl: "https://api.xiaomimimo.com/v1" },
  {
    source: "xiaomi-token-plan-cn",
    provider: "xiaomi-token-plan-cn",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  },
  {
    source: "xiaomi-token-plan-ams",
    provider: "xiaomi-token-plan-ams",
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
  },
  {
    source: "xiaomi-token-plan-sgp",
    provider: "xiaomi-token-plan-sgp",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
  },
] as const;

export function xiaomiModels({ data }: ModelsDevSource): Model<Api>[] {
  return XIAOMI_VARIANTS.flatMap(({ source: key, provider, baseUrl }) =>
    toolModels(data[key])
      .filter(([, source]) => source.status !== "deprecated")
      .map(([id, source]) =>
        modelsDevModel({
          id,
          source,
          api: "openai-completions",
          provider,
          baseUrl,
          compat: XIAOMI_COMPAT,
          thinkingLevelMap: source.reasoning === true ? XIAOMI_THINKING_LEVEL_MAP : undefined,
        }),
      ),
  );
}

const QWEN_TOKEN_PLAN_FALLBACK_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
} as const;

const QWEN_TOKEN_PLAN_REASONING_EFFORT_FALLBACK_MODEL_IDS = new Set(["glm-5", "glm-5.1"]);

const QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS = new Set(["qwen3.8-max-preview"]);

export const QWEN_TOKEN_PLAN_PROVIDER_IDS = new Set<string>([
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "qwen-token-plan-individual",
]);

const QWEN_TOKEN_PLAN_INDIVIDUAL_MODEL_IDS = new Set<string>([
  "deepseek-v4-flash-0731",
  "deepseek-v4-pro",
  "deepseek-v4-pro-0813",
  "glm-5.2",
  "qwen3.6-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.8-flash",
  "qwen3.8-max",
]);

const QWEN_TOKEN_PLAN_COMPAT: OpenAICompletionsCompat = {
  thinkingFormat: "qwen",
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsReasoningEffort: true,
};
const QWEN_TOKEN_PLAN_VARIANTS = [
  {
    source: "alibaba-token-plan",
    provider: "qwen-token-plan",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    modelIds: undefined,
  },
  {
    source: "alibaba-token-plan",
    provider: "qwen-token-plan-individual",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    modelIds: QWEN_TOKEN_PLAN_INDIVIDUAL_MODEL_IDS,
  },
  {
    source: "alibaba-token-plan-cn",
    provider: "qwen-token-plan-cn",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    modelIds: undefined,
  },
] as const;

type QwenTokenPlanVariant = (typeof QWEN_TOKEN_PLAN_VARIANTS)[number];

function qwenTokenPlanModel(
  { provider, baseUrl }: QwenTokenPlanVariant,
  [id, source]: readonly [string, ModelsDevModel],
): Model<Api> {
  const thinkingLevelMap =
    getEffortThinkingLevelMap(source.reasoning_options ?? []) ??
    (QWEN_TOKEN_PLAN_REASONING_EFFORT_FALLBACK_MODEL_IDS.has(id)
      ? QWEN_TOKEN_PLAN_FALLBACK_THINKING_LEVEL_MAP
      : undefined);
  return {
    ...modelsDevFields({ id, source }),
    api: "openai-completions",
    provider,
    baseUrl,
    compat:
      thinkingLevelMap === undefined
        ? { ...QWEN_TOKEN_PLAN_COMPAT, supportsReasoningEffort: false }
        : QWEN_TOKEN_PLAN_COMPAT,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
  };
}

export function qwenTokenPlanModels({ data, strict }: ModelsDevSource): Model<Api>[] {
  return QWEN_TOKEN_PLAN_VARIANTS.flatMap((variant) => {
    const { modelIds } = variant;
    const models = toolModels(data[variant.source])
      .filter(
        ([id]) =>
          !QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS.has(id) &&
          (modelIds === undefined || modelIds.has(id)),
      )
      .map((entry) => qwenTokenPlanModel(variant, entry));
    if (modelIds !== undefined && strict)
      assertExactModelIds(
        variant.provider,
        modelIds,
        models.map((model) => model.id),
      );
    return models;
  });
}
