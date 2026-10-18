import type { Api, Model, ModelCost, OpenAICompletionsCompat } from "../../src/types.ts";
import {
  applyAnthropicAllowedFallbackModelMetadata,
  isAnthropicFallbackMetadataModel,
} from "./anthropic-metadata.ts";
import { applyCatalogOverrides } from "./catalog-overrides.ts";
import { modelMetadata } from "./model-metadata.ts";
import { QWEN_TOKEN_PLAN_PROVIDER_IDS } from "./models-dev-regional.ts";
import type { ReasoningOptionsRegistry } from "./models-dev.ts";
import {
  ANT_LING_MODELS,
  DEEPSEEK_COMPAT,
  DEEPSEEK_MODELS,
  FALLBACK_MODELS,
} from "./static-models.ts";
import { CODEX_MODELS, MISSING_OPENAI_MODELS } from "./static-openai-models.ts";

const XAI_BUILTIN_EXCLUDED_MODEL_IDS = new Set([
  "grok-3",
  "grok-3-fast",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-build-0.1",
  "grok-code-fast-1",
]);
const MINIMAX_DIRECT_SUPPORTED_IDS = new Set([
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M3",
]);
const AZURE_CONTEXT_WINDOW_OVERRIDES: Readonly<Record<string, number>> = {
  "gpt-5.4": 1050000,
  "gpt-5.5": 1050000,
  "gpt-5.6-luna": 1050000,
  "gpt-5.6-sol": 1050000,
  "gpt-5.6-terra": 1050000,
};
const AZURE_DEEPSEEK_V4_PRO_COST: ModelCost = {
  input: 1.925,
  output: 3.828,
  cacheRead: 0.165,
  cacheWrite: 0,
};

function isCatalogedModel(model: Model<any>): boolean {
  if (model.provider === "xai" && XAI_BUILTIN_EXCLUDED_MODEL_IDS.has(model.id)) return false;
  if (
    (model.provider === "opencode" || model.provider === "opencode-go") &&
    model.id === "gpt-5.3-codex-spark"
  )
    return false;
  return (
    (model.provider !== "minimax" && model.provider !== "minimax-cn") ||
    MINIMAX_DIRECT_SUPPORTED_IDS.has(model.id)
  );
}

function addMissing(models: Model<any>[], additions: readonly Model<any>[]): void {
  for (const model of additions) {
    if (!models.some((m) => m.provider === model.provider && m.id === model.id)) models.push(model);
  }
}

function applyDeepSeekCompat(candidate: Model<any>): void {
  if (
    candidate.api !== "openai-completions" ||
    !candidate.id.includes("deepseek-v4") ||
    QWEN_TOKEN_PLAN_PROVIDER_IDS.has(candidate.provider)
  )
    return;
  const preservesNativeReasoningEffort =
    candidate.provider === "openrouter" || candidate.provider === "opencode";
  candidate.compat = {
    ...candidate.compat,
    ...(preservesNativeReasoningEffort
      ? {
          requiresReasoningContentOnAssistantMessages:
            DEEPSEEK_COMPAT.requiresReasoningContentOnAssistantMessages,
        }
      : DEEPSEEK_COMPAT),
  };
}

function azureOpenAiModels(models: readonly Model<any>[]): Model<Api>[] {
  return models
    .filter((model) => model.provider === "openai" && model.api === "openai-responses")
    .map((model) =>
      Object.assign({}, model, {
        api: "azure-openai-responses" as const,
        provider: "azure",
        baseUrl: "",
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cacheRead,
          cacheWrite: model.cost.cacheWrite,
        },
        contextWindow: AZURE_CONTEXT_WINDOW_OVERRIDES[model.id] ?? model.contextWindow,
      }),
    );
}

function azureDeepSeekModels(models: readonly Model<any>[]): Model<Api>[] {
  return models
    .filter((model) => model.provider === "deepseek" && model.id === "deepseek-v4-pro")
    .map((model) =>
      Object.assign({}, model, {
        provider: "azure",
        baseUrl: "",
        cost: AZURE_DEEPSEEK_V4_PRO_COST,
        compat: {
          ...(model.compat as OpenAICompletionsCompat),
          supportsDeveloperRole: false,
          supportsMidConvoSystemMessages: true,
          thinkingFormat: "openai" as const,
          supportsLongCacheRetention: false,
        },
      }),
    );
}

export interface CatalogAssembly {
  readonly upstream: readonly Model<any>[];
  readonly reasoning: ReasoningOptionsRegistry;
}

export function assembleChatModels({ upstream, reasoning }: CatalogAssembly): Model<any>[] {
  const models = upstream.filter(isCatalogedModel);
  for (const candidate of models) applyCatalogOverrides(candidate);
  addMissing(models, MISSING_OPENAI_MODELS);
  models.push(...DEEPSEEK_MODELS, ...ANT_LING_MODELS);
  for (const candidate of models) applyDeepSeekCompat(candidate);
  models.push(...CODEX_MODELS);
  addMissing(models, FALLBACK_MODELS);
  models.push(...azureOpenAiModels(models));
  models.push(...azureDeepSeekModels(models));
  const applyMetadata = modelMetadata(reasoning);
  for (const model of models) applyMetadata(model);
  applyAnthropicAllowedFallbackModelMetadata(models.filter(isAnthropicFallbackMetadataModel));
  return models;
}
