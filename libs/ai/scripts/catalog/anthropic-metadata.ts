import { Function } from "effect";

import type { AnthropicMessagesCompat, Api, Model, ModelPromptCache } from "../../src/types.ts";
import { mergeThinkingLevelMap } from "./thinking-maps.ts";

const ANTHROPIC_ALLOWED_FALLBACK_MODELS = {
  "claude-fable-5": ["claude-opus-4-8", "claude-opus-5"],
  "claude-opus-5": ["claude-opus-4-8"],
} satisfies Record<string, string[]>;

const VERIFIED_ANTHROPIC_MID_CONVO_EFFORT_PROVIDERS = new Set(["anthropic", "openrouter"]);

const MID_CONVO_EFFORT_UNSUPPORTED_ANTHROPIC_MODELS = new Set([
  "openrouter:anthropic/claude-opus-5",
]);

function supportsAnthropicMidConvoEffort(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^~?anthropic\//u, "");
  return (
    /^claude-opus-(?:5|5[.-]5)(?:-\d{8})?$/u.test(id) ||
    /^claude-(?:sonnet|haiku)-5[.-]5(?:-\d{8})?$/u.test(id) ||
    /^claude-(?:fable|mythos)-5(?:[.-]1)(?:-\d{8})?$/u.test(id)
  );
}

const ANTHROPIC_DISABLED_THINKING_MODELS = new Set([
  "claude-opus-5",
  "claude-haiku-5-5",
  "claude-haiku-5.5",
]);

function supportsAnthropicDisabledThinkingWithMidConvoEffort(modelId: string): boolean {
  const id = modelId
    .toLowerCase()
    .replace(/^~?anthropic\//u, "")
    .replace(/-\d{8}$/u, "");
  return ANTHROPIC_DISABLED_THINKING_MODELS.has(id);
}

function supportsAnthropicMidConvoSystemMessages(modelId: string): boolean {
  return (
    /^claude-opus-(?:4[.-]8|5(?:[.-]5)?)(?:-\d{8})?$/u.test(modelId) ||
    /^claude-(?:sonnet|haiku)-5[.-]5(?:-\d{8})?$/u.test(modelId) ||
    /^claude-(?:fable|mythos)-5(?:[.-]1)?(?:-\d{8})?$/u.test(modelId)
  );
}

export function isAnthropicAdaptiveThinkingModel(modelId: string): boolean {
  return (
    modelId.includes("opus-4-6") ||
    modelId.includes("opus-4.6") ||
    modelId.includes("opus-4-7") ||
    modelId.includes("opus-4.7") ||
    modelId.includes("opus-4-8") ||
    modelId.includes("opus-4.8") ||
    modelId.includes("opus-5") ||
    modelId.includes("opus.5") ||
    modelId.includes("sonnet-4-6") ||
    modelId.includes("sonnet-4.6") ||
    modelId.includes("sonnet-5") ||
    modelId.includes("sonnet.5") ||
    modelId.includes("haiku-5") ||
    modelId.includes("haiku.5") ||
    modelId.includes("fable-5") ||
    modelId.includes("mythos-5")
  );
}

export function isAnthropicTemperatureUnsupportedModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes("opus-4-7") ||
    id.includes("opus-4.7") ||
    id.includes("opus-4-8") ||
    id.includes("opus-4.8") ||
    id.includes("opus-5") ||
    id.includes("opus.5") ||
    id.includes("sonnet-5-5") ||
    id.includes("sonnet-5.5") ||
    id.includes("haiku-5-5") ||
    id.includes("haiku-5.5")
  );
}

export const mergeAnthropicMessagesCompat: {
  (compat: AnthropicMessagesCompat): (model: Model<Api>) => void;
  (model: Model<Api>, compat: AnthropicMessagesCompat): void;
} = Function.dual(2, (model: Model<Api>, compat: AnthropicMessagesCompat): void => {
  model.compat = { ...(model.compat as AnthropicMessagesCompat | undefined), ...compat };
});

export function applyAnthropicMessagesCompatMetadata(model: Model<Api>): void {
  if (model.api !== "anthropic-messages") return;
  const compat = getAnthropicMessagesCompat(model.provider, model.id);
  if (compat !== undefined) {
    mergeAnthropicMessagesCompat(model, compat);
    if (
      compat.supportsMidConvoEffort === true &&
      !supportsAnthropicDisabledThinkingWithMidConvoEffort(model.id)
    ) {
      mergeThinkingLevelMap(model, { off: null });
    }
  }
}

export function isAnthropicFallbackMetadataModel(
  model: Model<Api>,
): model is Model<"anthropic-messages"> {
  if (model.provider !== "anthropic" || model.api !== "anthropic-messages") return false;
  return (
    model.id in ANTHROPIC_ALLOWED_FALLBACK_MODELS ||
    Object.values(ANTHROPIC_ALLOWED_FALLBACK_MODELS).some((fallbackModelIds) =>
      fallbackModelIds.includes(model.id),
    )
  );
}

export function applyAnthropicAllowedFallbackModelMetadata(
  models: readonly Model<"anthropic-messages">[],
): void {
  const modelsById = new Map(models.map((model) => [model.id, model]));
  for (const [modelId, fallbackModelIds] of Object.entries(ANTHROPIC_ALLOWED_FALLBACK_MODELS)) {
    const model = modelsById.get(modelId);
    if (model === undefined) continue;

    const compatibleFallbackModelIds =
      model.compat?.supportsMidConvoEffort === true
        ? fallbackModelIds.filter(supportsAnthropicMidConvoEffort)
        : fallbackModelIds;
    const allowedFallbackModels = compatibleFallbackModelIds.flatMap((fallbackModelId) => {
      const fallbackModel = modelsById.get(fallbackModelId);
      return fallbackModel === undefined
        ? []
        : [{ provider: fallbackModel.provider, model: fallbackModel.id, cost: fallbackModel.cost }];
    });
    if (allowedFallbackModels.length > 0) {
      mergeAnthropicMessagesCompat(model, { allowedFallbackModels });
    }
  }
}

const ANTHROPIC_PROMPT_CACHE: ModelPromptCache = { short: 300, long: 3600 };

export function applyPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    model.promptCache = ANTHROPIC_PROMPT_CACHE;
  }
}

function getAnthropicMessagesCompat(
  provider: string,
  modelId: string,
): AnthropicMessagesCompat | undefined {
  const compat: AnthropicMessagesCompat = {};
  if (
    VERIFIED_ANTHROPIC_MID_CONVO_EFFORT_PROVIDERS.has(provider) &&
    supportsAnthropicMidConvoEffort(modelId) &&
    !MID_CONVO_EFFORT_UNSUPPORTED_ANTHROPIC_MODELS.has(`${provider}:${modelId}`)
  ) {
    compat.supportsMidConvoEffort = true;
  }
  if (provider === "anthropic" && supportsAnthropicMidConvoSystemMessages(modelId)) {
    compat.supportsMidConvoSystemMessages = true;
    compat.supportsMidConvoToolChanges = true;
  }
  if (provider === "opencode" && supportsAnthropicMidConvoSystemMessages(modelId)) {
    compat.supportsMidConvoSystemMessages = true;
  }
  if ((provider === "opencode" || provider === "opencode-go") && modelId === "qwen3.8-flash") {
    compat.allowEmptySignature = true;
  }
  return Object.keys(compat).length > 0 ? compat : undefined;
}
