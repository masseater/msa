import type { Model, OpenAICompletionsCompat } from "../../src/types.ts";
import anthropicMetadata from "./anthropic-metadata.ts";
import type catalogAssemblyTypes from "./catalog-assembly.types.ts";
import applyCatalogOverrides from "./catalog-overrides.ts";
import modelMetadataModule from "./model-metadata.ts";
import staticModels from "./static-models.ts";
import staticOpenaiModels from "./static-openai-models.ts";

const { applyAnthropicAllowedFallbackModelMetadata, isAnthropicFallbackMetadataModel } =
  anthropicMetadata;
const { modelMetadata } = modelMetadataModule;
const { FALLBACK_MODELS } = staticModels;
const { CODEX_MODELS, MISSING_OPENAI_MODELS } = staticOpenaiModels;

const DEEPSEEK_COMPAT = {
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
} satisfies OpenAICompletionsCompat;

function isCatalogedModel(model: Model<any>): boolean {
  return !(
    (model.provider === "opencode" || model.provider === "opencode-go") &&
    model.id === "gpt-5.3-codex-spark"
  );
}

function addMissing(models: Model<any>[], additions: readonly Model<any>[]): void {
  for (const model of additions) {
    if (!models.some((m) => m.provider === model.provider && m.id === model.id)) models.push(model);
  }
}

function applyDeepSeekCompat(candidate: Model<any>): void {
  if (candidate.api !== "openai-completions" || !candidate.id.includes("deepseek-v4")) return;
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

function assembleChatModels({
  upstream,
  reasoning,
}: catalogAssemblyTypes.CatalogAssembly): Model<any>[] {
  const models = upstream.filter(isCatalogedModel);
  for (const candidate of models) applyCatalogOverrides(candidate);
  addMissing(models, MISSING_OPENAI_MODELS);
  for (const candidate of models) applyDeepSeekCompat(candidate);
  models.push(...CODEX_MODELS);
  addMissing(models, FALLBACK_MODELS);
  const applyMetadata = modelMetadata(reasoning);
  for (const model of models) applyMetadata(model);
  applyAnthropicAllowedFallbackModelMetadata(models.filter(isAnthropicFallbackMetadataModel));
  return models;
}

export default assembleChatModels;
