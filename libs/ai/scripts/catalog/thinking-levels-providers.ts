import type typesModule from "../../src/types.types.ts";
import thinkingMaps from "./thinking-maps.ts";

const { mergeThinkingLevelMap } = thinkingMaps;

const OPENCODE_GO_GLM52_THINKING_LEVEL_MAP = {
  high: "high",
  low: null,
  max: "max",
  medium: null,
  minimal: null,
  off: null,
} as const;

function supportsOpenAiXhigh(modelId: string): boolean {
  return (
    modelId.includes("gpt-5.2") ||
    modelId.includes("gpt-5.3") ||
    modelId.includes("gpt-5.4") ||
    modelId.includes("gpt-5.5") ||
    modelId.includes("gpt-5.6") ||
    modelId.includes("gpt-6")
  );
}

function applyHostedThinkingLevels(model: typesModule.Model<any>): void {
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

function applyGatewayThinkingLevels(model: typesModule.Model<any>): void {
  if (model.provider === "opencode-go" && model.id === "glm-5.2") {
    mergeThinkingLevelMap(model, OPENCODE_GO_GLM52_THINKING_LEVEL_MAP);
  }
  if (model.provider === "opencode-go" && model.id === "kimi-k2.6") {
    mergeThinkingLevelMap(model, { low: null, medium: null, minimal: null });
  }
  if (model.provider === "opencode" && model.id === "grok-build-0.1") {
    mergeThinkingLevelMap(model, { low: null, medium: null, minimal: null, off: null });
  }
}

const thinkingLevelsProviders = {
  applyGatewayThinkingLevels,
  applyHostedThinkingLevels,
  supportsOpenAiXhigh,
};

export default thinkingLevelsProviders;
