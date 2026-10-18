import type { AnthropicMessagesCompat, Model } from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import type { ReasoningOptionsRegistry } from "./models-dev.ts";
import { mergeThinkingLevelMap } from "./thinking-maps.ts";

const OPENCODE_GO_GLM52_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
} as const;

const ANT_LING_RING_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: "xhigh",
} as const;

export function supportsOpenAiXhigh(modelId: string): boolean {
  return (
    modelId.includes("gpt-5.2") ||
    modelId.includes("gpt-5.3") ||
    modelId.includes("gpt-5.4") ||
    modelId.includes("gpt-5.5") ||
    modelId.includes("gpt-5.6") ||
    modelId.includes("gpt-6")
  );
}

export function applyHostedThinkingLevels(model: Model<any>): void {
  if (model.provider === "groq" && model.id === "qwen/qwen3.6-27b") {
    mergeThinkingLevelMap(model, { minimal: null, low: null, medium: null, high: "default" });
  }
  if (model.provider === "openai-codex" && supportsOpenAiXhigh(model.id)) {
    mergeThinkingLevelMap(model, { minimal: "low" });
  }
  if (
    (model.provider === "moonshotai" || model.provider === "moonshotai-cn") &&
    (model.id === "kimi-k2.7-code" || model.id === "kimi-k2.7-code-highspeed")
  ) {
    mergeThinkingLevelMap(model, { off: null });
  }
  if (model.provider === "openrouter" && model.id.startsWith("inception/mercury-2")) {
    mergeThinkingLevelMap(model, { off: null });
  }
  if (model.provider === "openrouter" && model.id === "z-ai/glm-5.2") {
    mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  }
}

function applyFireworksAdaptiveThinkingLevels(
  model: Model<any>,
  reasoning: ReasoningOptionsRegistry,
): void {
  if (
    model.id === "accounts/fireworks/models/qwen3p8-max" &&
    model.thinkingLevelMap === undefined
  ) {
    const thinkingLevelMap = getEffortThinkingLevelMap([
      { type: "effort", values: ["low", "medium", "xhigh"] },
    ]);
    if (thinkingLevelMap !== undefined) model.thinkingLevelMap = thinkingLevelMap;
  }
  const reasoningOptions = reasoning.get(`${model.provider}:${model.id}`);
  if (
    reasoningOptions?.some((option) => option.type === "toggle") === true ||
    model.id === "accounts/fireworks/models/qwen3p8-2p4t-a95b"
  ) {
    mergeThinkingLevelMap(model, { off: "none" });
  }
  if (model.id === "accounts/fireworks/models/deepseek-v4-pro-0813") {
    mergeThinkingLevelMap(model, { low: "low" });
  }
}

export const fireworksThinkingLevels =
  (reasoning: ReasoningOptionsRegistry) =>
  (model: Model<any>): void => {
    if (model.provider !== "fireworks") return;
    if (
      model.api === "anthropic-messages" &&
      (model.compat as AnthropicMessagesCompat | undefined)?.forceAdaptiveThinking === true
    ) {
      applyFireworksAdaptiveThinkingLevels(model, reasoning);
    }
    if (model.id.includes("glm-5p2")) {
      mergeThinkingLevelMap(model, {
        off: "none",
        minimal: null,
        low: null,
        medium: null,
        max: "max",
      });
    }
    if (model.id.includes("kimi-k3")) {
      mergeThinkingLevelMap(model, { medium: null });
    }
  };

export function applyGatewayThinkingLevels(model: Model<any>): void {
  if (model.provider === "opencode-go" && model.id === "glm-5.2") {
    mergeThinkingLevelMap(model, OPENCODE_GO_GLM52_THINKING_LEVEL_MAP);
  }
  if (model.provider === "opencode-go" && model.id === "kimi-k2.6") {
    mergeThinkingLevelMap(model, { minimal: null, low: null, medium: null });
  }
  if (model.provider === "opencode" && model.id === "grok-build-0.1") {
    mergeThinkingLevelMap(model, { off: null, minimal: null, low: null, medium: null });
  }
  if (model.provider === "ant-ling" && model.reasoning) {
    mergeThinkingLevelMap(model, ANT_LING_RING_THINKING_LEVEL_MAP);
  }
}
