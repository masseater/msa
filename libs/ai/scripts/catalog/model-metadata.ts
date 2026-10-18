import type {
  AnthropicMessagesCompat,
  AnyModel,
  Api,
  Model,
  OpenAICompletionsCompat,
} from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import {
  applyAnthropicMessagesCompatMetadata,
  applyPromptCacheMetadata,
} from "./anthropic-metadata.ts";
import type { ReasoningOptionsRegistry } from "./models-dev.ts";
import {
  applyOpenAICompletionsCompatMetadata,
  detectOpenAICompletionsCompat,
} from "./openai-completions-compat.ts";
import {
  applyOpenAICompletionsTranscriptMetadata,
  applyOpenAIExplicitPromptCacheMetadata,
  applyOpenAIGrammarToolCompatMetadata,
  applyOpenAIMidConvoEffortMetadata,
  applyOpenAIResponsesTranscriptMetadata,
  applyOpenAIToolSearchMetadata,
  applyStrictToolCompatMetadata,
} from "./openai-metadata.ts";
import { applyThinkingLevelMetadata } from "./thinking-levels.ts";
import { mergeThinkingLevelMap } from "./thinking-maps.ts";

const DEFAULT_IMAGE_RESIZE = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 4.5 * 1024 * 1024,
  jpegQuality: 80,
} as const;

function supportsDirectReasoningEffort(model: Model<Api>): boolean {
  if (model.api === "anthropic-messages") {
    return (model.compat as AnthropicMessagesCompat | undefined)?.forceAdaptiveThinking === true;
  }
  if (model.api === "openai-responses" || model.api === "openai-codex-responses") return true;
  if (model.api !== "openai-completions") return false;

  const compat = {
    ...detectOpenAICompletionsCompat(model as Model<"openai-completions">),
    ...(model.compat as OpenAICompletionsCompat | undefined),
  };
  return compat.thinkingFormat === "openai" && compat.supportsReasoningEffort;
}

export function applyImageInputMetadata(model: AnyModel): void {
  if (!model.input.includes("image")) return;

  const providerLimits: AnyModel["inputLimits"] =
    model.provider === "anthropic"
      ? {
          maxRequestBytes: 32 * 1024 * 1024,
          images: {
            maxPerRequest: model.type !== "image" && model.contextWindow === 200000 ? 100 : 600,
          },
        }
      : model.provider === "openai"
        ? { maxRequestBytes: 512 * 1024 * 1024, images: { maxPerRequest: 1500 } }
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

function reasoningOptionMetadata(reasoning: ReasoningOptionsRegistry): (model: Model<Api>) => void {
  return (model) => {
    const reasoningOptions = reasoning.get(`${model.provider}:${model.id}`);
    if (reasoningOptions === undefined || !supportsDirectReasoningEffort(model)) return;
    const thinkingLevelMap = getEffortThinkingLevelMap(reasoningOptions);
    if (thinkingLevelMap !== undefined) mergeThinkingLevelMap(model, thinkingLevelMap);
  };
}

export function modelMetadata(reasoning: ReasoningOptionsRegistry): (model: Model<Api>) => void {
  const steps: readonly ((model: Model<Api>) => void)[] = [
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
