import type { Api, Model } from "../../src/types.ts";
import {
  isAnthropicAdaptiveThinkingModel,
  isAnthropicTemperatureUnsupportedModel,
  mergeAnthropicMessagesCompat,
} from "./anthropic-metadata.ts";
import type { ReasoningOptionsRegistry } from "./models-dev.ts";
import {
  applyGatewayThinkingLevels,
  applyHostedThinkingLevels,
  fireworksThinkingLevels,
  supportsOpenAiXhigh,
} from "./thinking-levels-providers.ts";
import {
  AZURE_DEEPSEEK_V4_THINKING_LEVEL_MAP,
  DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP,
  DEEPSEEK_V4_THINKING_LEVEL_MAP,
  mergeThinkingLevelMap,
} from "./thinking-maps.ts";

const OPENAI_RESPONSES_NONE_REASONING_MODELS = new Set([
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-sol",
  "gpt-6-luna",
]);

const GPT_6_MODEL_IDS = new Set(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol"]);

const OPENAI_RESPONSES_APIS = new Set<Api>([
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);

function supportsOpenAiMax(model: Model<Api>): boolean {
  return (
    (model.id.includes("gpt-5.6") || model.id.includes("gpt-6")) &&
    (OPENAI_RESPONSES_APIS.has(model.api) || model.api === "openai-completions")
  );
}

function applyGpt6ThinkingLevels(model: Model<any>): void {
  if (!GPT_6_MODEL_IDS.has(model.id) || !OPENAI_RESPONSES_APIS.has(model.api)) return;
  mergeThinkingLevelMap(model, {
    off: model.id === "gpt-6-astra" || model.id === "gpt-6.1-sol" ? null : "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  });
}

function applyOpenAiThinkingLevels(model: Model<any>): void {
  if (
    (model.api === "openai-responses" || model.api === "azure-openai-responses") &&
    model.id.startsWith("gpt-5")
  ) {
    mergeThinkingLevelMap(model, { off: null });
  }
  applyGpt6ThinkingLevels(model);
  if (
    model.api === "openai-responses" &&
    model.provider === "openai" &&
    OPENAI_RESPONSES_NONE_REASONING_MODELS.has(model.id)
  ) {
    mergeThinkingLevelMap(model, { off: "none" });
  }
  if (
    model.provider === "xai" &&
    model.api === "openai-responses" &&
    model.thinkingLevelMap === undefined
  ) {
    mergeThinkingLevelMap(model, { off: null, minimal: null });
  }
  if (supportsOpenAiXhigh(model.id)) mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  if (supportsOpenAiMax(model)) mergeThinkingLevelMap(model, { max: "max" });
  if (model.provider === "openai" && model.id === "gpt-5.5") {
    mergeThinkingLevelMap(model, { minimal: null });
  }
  if (model.id.endsWith("gpt-5.5-pro")) {
    mergeThinkingLevelMap(model, { off: null, minimal: null, low: null });
  }
}

const ANTHROPIC_MAX_EFFORT_MARKERS = ["opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6"];
const ANTHROPIC_XHIGH_EFFORT_MARKERS = [
  "opus-4-7",
  "opus-4.7",
  "opus-4-8",
  "opus-4.8",
  "opus-5",
  "opus.5",
  "sonnet-5",
  "sonnet.5",
  "haiku-5",
  "haiku.5",
];

function applyAnthropicThinkingLevels(model: Model<any>): void {
  if (ANTHROPIC_MAX_EFFORT_MARKERS.some((marker) => model.id.includes(marker))) {
    mergeThinkingLevelMap(model, { max: "max" });
  }
  if (ANTHROPIC_XHIGH_EFFORT_MARKERS.some((marker) => model.id.includes(marker))) {
    mergeThinkingLevelMap(model, { xhigh: "xhigh", max: "max" });
  }
  if (model.id.includes("fable-5")) {
    mergeThinkingLevelMap(model, { off: null, xhigh: "xhigh", max: "max" });
  }
  if (model.api === "anthropic-messages" && isAnthropicAdaptiveThinkingModel(model.id)) {
    mergeAnthropicMessagesCompat(model, { forceAdaptiveThinking: true });
  }
  if (model.api === "anthropic-messages" && isAnthropicTemperatureUnsupportedModel(model.id)) {
    mergeAnthropicMessagesCompat(model, { supportsTemperature: false });
  }
}

function deepSeekThinkingLevelMap(model: Model<any>) {
  if (model.provider === "openrouter")
    return { ...DEEPSEEK_V4_THINKING_LEVEL_MAP, xhigh: "xhigh", max: null } as const;
  if (model.provider === "azure") return AZURE_DEEPSEEK_V4_THINKING_LEVEL_MAP;
  const isDeepSeekHost =
    model.provider === "deepseek" ||
    model.provider === "opencode" ||
    model.provider === "opencode-go";
  return isDeepSeekHost && model.id.includes("deepseek-v4-flash")
    ? DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP
    : DEEPSEEK_V4_THINKING_LEVEL_MAP;
}

function applyDeepSeekThinkingLevels(model: Model<any>): void {
  if (
    model.api === "openai-completions" &&
    model.id.includes("deepseek-v4") &&
    model.thinkingLevelMap === undefined
  ) {
    mergeThinkingLevelMap(model, deepSeekThinkingLevelMap(model));
  }
}

export function thinkingLevelMetadata(
  reasoning: ReasoningOptionsRegistry,
): (model: Model<any>) => void {
  const applyFireworksThinkingLevels = fireworksThinkingLevels(reasoning);
  return (model) => {
    applyOpenAiThinkingLevels(model);
    applyAnthropicThinkingLevels(model);
    applyDeepSeekThinkingLevels(model);
    applyHostedThinkingLevels(model);
    applyFireworksThinkingLevels(model);
    applyGatewayThinkingLevels(model);
  };
}
