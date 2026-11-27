import type typesModule from "../../src/types.types.ts";
import getEffortThinkingLevelMap from "../models-dev-reasoning-options.ts";
import anthropicMetadata from "./anthropic-metadata.ts";
import type modelsDevTypes from "./models-dev.types.ts";
import openaiCompletionsCompat from "./openai-completions-compat.ts";
import openaiMetadata from "./openai-metadata.ts";
import applyThinkingLevelMetadata from "./thinking-levels.ts";
import thinkingMaps from "./thinking-maps.ts";

const { applyAnthropicMessagesCompatMetadata, applyPromptCacheMetadata } = anthropicMetadata;
const { applyOpenAICompletionsCompatMetadata, detectOpenAICompletionsCompat } =
  openaiCompletionsCompat;
const {
  applyOpenAICompletionsTranscriptMetadata,
  applyOpenAIExplicitPromptCacheMetadata,
  applyOpenAIGrammarToolCompatMetadata,
  applyOpenAIMidConvoEffortMetadata,
  applyOpenAIResponsesTranscriptMetadata,
  applyOpenAIToolSearchMetadata,
  applyStrictToolCompatMetadata,
} = openaiMetadata;
const { mergeThinkingLevelMap } = thinkingMaps;

const DEFAULT_IMAGE_RESIZE = {
  jpegQuality: 80,
  maxBytes: 4.5 * 1024 * 1024,
  maxHeight: 2000,
  maxWidth: 2000,
} as const;

function supportsDirectReasoningEffort(model: typesModule.Model<typesModule.Api>): boolean {
  if (model.api === "anthropic-messages") {
    return (
      (model.compat as typesModule.AnthropicMessagesCompat | undefined)?.forceAdaptiveThinking ===
      true
    );
  }
  if (model.api === "openai-responses" || model.api === "openai-codex-responses") return true;
  if (model.api !== "openai-completions") return false;

  const compat = {
    ...detectOpenAICompletionsCompat(model as typesModule.Model<"openai-completions">),
    ...(model.compat as typesModule.OpenAICompletionsCompat | undefined),
  };
  return compat.thinkingFormat === "openai" && compat.supportsReasoningEffort;
}

function applyImageInputMetadata(model: typesModule.AnyModel): void {
  if (!model.input.includes("image")) return;

  const providerLimits: typesModule.AnyModel["inputLimits"] =
    model.provider === "anthropic-api"
      ? {
          images: {
            maxPerRequest: model.type !== "image" && model.contextWindow === 200000 ? 100 : 600,
          },
          maxRequestBytes: 32 * 1024 * 1024,
        }
      : model.provider === "openai"
        ? { images: { maxPerRequest: 1500 }, maxRequestBytes: 512 * 1024 * 1024 }
        : undefined;
  const configuredImages = model.inputLimits?.images;
  model.inputLimits = {
    ...providerLimits,
    ...model.inputLimits,
    images: {
      ...providerLimits?.images,
      ...configuredImages,
      resize: { ...DEFAULT_IMAGE_RESIZE, ...configuredImages?.resize },
    },
  };
}

function reasoningOptionMetadata(
  reasoning: modelsDevTypes.ReasoningOptionsRegistry,
): (model: typesModule.Model<typesModule.Api>) => void {
  return (model) => {
    const reasoningOptions = reasoning.get(`${model.provider}:${model.id}`);
    if (reasoningOptions === undefined || !supportsDirectReasoningEffort(model)) return;
    const thinkingLevelMap = getEffortThinkingLevelMap(reasoningOptions);
    if (thinkingLevelMap !== undefined) mergeThinkingLevelMap(model, thinkingLevelMap);
  };
}

function modelMetadata(
  reasoning: modelsDevTypes.ReasoningOptionsRegistry,
): (model: typesModule.Model<typesModule.Api>) => void {
  const steps: readonly ((model: typesModule.Model<typesModule.Api>) => void)[] = [
    applyOpenAICompletionsCompatMetadata,
    applyAnthropicMessagesCompatMetadata,
    reasoningOptionMetadata(reasoning),
    applyThinkingLevelMetadata,
    applyStrictToolCompatMetadata,
    applyOpenAIGrammarToolCompatMetadata,
    applyOpenAIToolSearchMetadata,
    applyOpenAICompletionsTranscriptMetadata,
    applyOpenAIResponsesTranscriptMetadata,
    applyOpenAIExplicitPromptCacheMetadata,
    applyOpenAIMidConvoEffortMetadata,
    applyPromptCacheMetadata,
    applyImageInputMetadata,
  ];
  return (model) => {
    for (const step of steps) step(model);
  };
}

const modelMetadataModule = {
  applyImageInputMetadata,
  modelMetadata,
};

export default modelMetadataModule;
