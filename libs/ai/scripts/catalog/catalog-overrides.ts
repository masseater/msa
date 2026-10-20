import type { Model } from "../../src/types.ts";
import openaiPricing from "./openai-pricing.ts";
import thinkingMaps from "./thinking-maps.ts";

const {
  OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
  OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS,
  OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS,
  OPENAI_STANDARD_COSTS_BY_ID,
  withOpenAiLongContextPricing,
} = openaiPricing;
const { mergeThinkingLevelMap } = thinkingMaps;

const KIMI_K3_MAX_TOKENS = 131072;
const OPENROUTER_KIMI_K3_MODEL_IDS = new Set(["moonshotai/kimi-k3", "~moonshotai/kimi-latest"]);
const CLAUDE_5_5_MODEL_IDS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const CLAUDE_4_6_MODEL_IDS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4.6",
  "claude-sonnet-4.6",
]);
const ANTHROPIC_HOSTS = new Set(["anthropic-api", "opencode", "opencode-go"]);
const OPENCODE_HOSTS = new Set(["opencode", "opencode-go"]);

function overrideAnthropicLimits(candidate: Model<any>): void {
  if (candidate.provider === "anthropic-api" && CLAUDE_5_5_MODEL_IDS.has(candidate.id)) {
    mergeThinkingLevelMap(candidate, {
      ...(candidate.id === "claude-haiku-5-5" ? {} : { off: null }),
      high: "high",
      low: "low",
      max: "max",
      medium: "medium",
      minimal: null,
      xhigh: "xhigh",
    });
  }
  if (ANTHROPIC_HOSTS.has(candidate.provider) && CLAUDE_4_6_MODEL_IDS.has(candidate.id)) {
    candidate.contextWindow = 1000000;
  }
  if (
    OPENCODE_HOSTS.has(candidate.provider) &&
    (candidate.id === "claude-sonnet-4-5" || candidate.id === "claude-sonnet-4")
  ) {
    candidate.contextWindow = 200000;
  }
}

function overrideOpenAiLimits(candidate: Model<any>): void {
  if (OPENCODE_HOSTS.has(candidate.provider) && candidate.id === "gpt-5.4") {
    candidate.contextWindow = 272000;
    candidate.maxTokens = 128000;
  }
  if (candidate.provider === "openai" && OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS.has(candidate.id)) {
    candidate.contextWindow = OPENAI_LONG_CONTEXT_INPUT_THRESHOLD;
    candidate.maxTokens = 128000;
  }
  if (candidate.provider === "openai" && OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS.has(candidate.id)) {
    const standardCost = OPENAI_STANDARD_COSTS_BY_ID[candidate.id];
    candidate.cost = withOpenAiLongContextPricing(standardCost ?? candidate.cost);
  }
  if (candidate.provider === "openai" && candidate.id === "gpt-5-pro") {
    candidate.maxTokens = 128000;
  }
}

function overrideGatewayModels(candidate: Model<any>): void {
  if (candidate.provider !== "openrouter") return;
  if (OPENROUTER_KIMI_K3_MODEL_IDS.has(candidate.id)) candidate.maxTokens = KIMI_K3_MAX_TOKENS;
  if (candidate.id === "moonshotai/kimi-k2.5") {
    candidate.cost.input = 0.41;
    candidate.cost.output = 2.06;
    candidate.cost.cacheRead = 0.07;
    candidate.maxTokens = 4096;
  }
  if (candidate.id.startsWith("moonshotai/kimi-k2.6")) {
    candidate.compat = {
      ...candidate.compat,
      requiresReasoningContentOnAssistantMessages: true,
      supportsDeveloperRole: false,
    };
  }
  if (candidate.id === "z-ai/glm-5") {
    candidate.cost.input = 0.6;
    candidate.cost.output = 1.9;
    candidate.cost.cacheRead = 0.119;
  }
}

function applyCatalogOverrides(candidate: Model<any>): void {
  overrideAnthropicLimits(candidate);
  overrideOpenAiLimits(candidate);
  overrideGatewayModels(candidate);
}

export default applyCatalogOverrides;
