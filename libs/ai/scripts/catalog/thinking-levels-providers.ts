import type { Model } from "../../src/types.ts";
import { mergeThinkingLevelMap } from "./thinking-maps.ts";

const OPENCODE_GO_GLM52_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
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
  if (model.provider === "openai-codex" && supportsOpenAiXhigh(model.id)) {
    mergeThinkingLevelMap(model, { minimal: "low" });
  }
  if (model.provider === "openrouter" && model.id.startsWith("inception/mercury-2")) {
    mergeThinkingLevelMap(model, { off: null });
  }
  if (model.provider === "openrouter" && model.id === "z-ai/glm-5.2") {
    mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  }
}

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
}
