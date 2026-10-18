import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import {
  modelsDevModel,
  type ModelsDevSource,
  type ThinkingLevelMap,
  toolModels,
} from "./models-dev.ts";

const TOGETHER_BASE_URL = "https://api.together.ai/v1";

const TOGETHER_BASE_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

const TOGETHER_TOGGLE_REASONING_COMPAT: OpenAICompletionsCompat = {
  ...TOGETHER_BASE_COMPAT,
  thinkingFormat: "together",
};

const TOGETHER_REASONING_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...TOGETHER_BASE_COMPAT,
  supportsReasoningEffort: true,
  thinkingFormat: "openai",
};

const TOGETHER_TOGGLE_REASONING_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...TOGETHER_TOGGLE_REASONING_COMPAT,
  supportsReasoningEffort: true,
};

export const TOGETHER_REASONING_ONLY_MODELS = new Set([
  "deepseek-ai/DeepSeek-R1",
  "MiniMaxAI/MiniMax-M2.7",
]);

const TOGETHER_REASONING_EFFORT_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

const TOGETHER_TOGGLE_REASONING_EFFORT_MODELS = new Set(["deepseek-ai/DeepSeek-V4-Pro-0813"]);

const TOGETHER_FIXED_REASONING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
} as const;

const TOGETHER_REASONING_EFFORT_LEVEL_MAP = {
  off: null,
  minimal: null,
} as const;

const TOGETHER_DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
} as const;

const TOGETHER_TOGGLE_REASONING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
} as const;

function getTogetherCompat(modelId: string, reasoning: boolean): OpenAICompletionsCompat {
  if (!reasoning) return TOGETHER_BASE_COMPAT;
  if (TOGETHER_REASONING_EFFORT_MODELS.has(modelId)) return TOGETHER_REASONING_EFFORT_COMPAT;
  if (TOGETHER_TOGGLE_REASONING_EFFORT_MODELS.has(modelId))
    return TOGETHER_TOGGLE_REASONING_EFFORT_COMPAT;
  if (TOGETHER_REASONING_ONLY_MODELS.has(modelId)) return TOGETHER_BASE_COMPAT;
  return TOGETHER_TOGGLE_REASONING_COMPAT;
}

function getTogetherThinkingLevelMap(
  modelId: string,
  reasoning: boolean,
): ThinkingLevelMap | undefined {
  if (!reasoning) return undefined;
  if (TOGETHER_REASONING_EFFORT_MODELS.has(modelId))
    return { ...TOGETHER_REASONING_EFFORT_LEVEL_MAP };
  if (TOGETHER_TOGGLE_REASONING_EFFORT_MODELS.has(modelId))
    return { ...TOGETHER_DEEPSEEK_V4_THINKING_LEVEL_MAP };
  if (TOGETHER_REASONING_ONLY_MODELS.has(modelId)) return { ...TOGETHER_FIXED_REASONING_LEVEL_MAP };
  return { ...TOGETHER_TOGGLE_REASONING_LEVEL_MAP };
}

export function togetherModels({ data, remember }: ModelsDevSource): Model<Api>[] {
  const provider = data["together"] ?? data["togetherai"] ?? data["together-ai"];
  return toolModels(provider)
    .filter(([, source]) => source.status !== "deprecated")
    .map(([id, source]) => {
      const reasoning = source.reasoning === true;
      const thinkingLevelMap = getTogetherThinkingLevelMap(id, reasoning);
      remember("together", id, source);
      return modelsDevModel({
        id,
        source,
        api: "openai-completions",
        provider: "together",
        baseUrl: TOGETHER_BASE_URL,
        thinkingLevelMap,
        compat: getTogetherCompat(id, reasoning),
      });
    });
}
