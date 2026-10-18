import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  OpenAICompletionsCompat,
} from "../../src/types.ts";
import {
  type ModelsDevModel,
  modelsDevModel,
  type ModelsDevSource,
  toolModels,
} from "./models-dev.ts";

const FIREWORKS_ADAPTIVE_THINKING_FALLBACK_MODELS = new Set([
  "accounts/fireworks/models/deepseek-v4-flash-0731",
  "accounts/fireworks/models/deepseek-v4-flash-vision-exp",
  "accounts/fireworks/models/deepseek-v4-pro-0813",
  "accounts/fireworks/models/qwen3p8-max",
  "accounts/fireworks/models/qwen3p8-2p4t-a95b",
]);

const FIREWORKS_ANTHROPIC_COMPAT: AnthropicMessagesCompat = {
  allowEmptySignature: true,
  sendSessionAffinityHeaders: true,
  supportsEagerToolInputStreaming: false,
  supportsCacheControlOnTools: false,
  supportsLongCacheRetention: false,
};
const FIREWORKS_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  sendSessionAffinityHeaders: true,
  supportsLongCacheRetention: false,
};
const FIREWORKS_KIMI_K3_COMPAT: OpenAICompletionsCompat = {
  ...FIREWORKS_OPENAI_COMPAT,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "openai",
};

function fireworksRoute(
  id: string,
  source: ModelsDevModel,
): { readonly api: Api; readonly baseUrl: string; readonly compat: Model<Api>["compat"] } {
  if (id.includes("glm-") || id.includes("kimi-k3")) {
    return {
      api: "openai-completions",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      compat: id.includes("glm-") ? FIREWORKS_OPENAI_COMPAT : FIREWORKS_KIMI_K3_COMPAT,
    };
  }
  const adaptive =
    source.reasoning_options?.some((option) => option.type === "effort") === true ||
    FIREWORKS_ADAPTIVE_THINKING_FALLBACK_MODELS.has(id);
  return {
    api: "anthropic-messages",
    baseUrl: "https://api.fireworks.ai/inference",
    compat: {
      ...FIREWORKS_ANTHROPIC_COMPAT,
      ...(adaptive ? { forceAdaptiveThinking: true } : {}),
    },
  };
}

export function fireworksModels({ data, remember }: ModelsDevSource): Model<Api>[] {
  return toolModels(data["fireworks-ai"]).map(([id, source]) => {
    remember("fireworks", id, source);
    return modelsDevModel({ id, source, provider: "fireworks", ...fireworksRoute(id, source) });
  });
}
