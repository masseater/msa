import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import {
  getEffortThinkingLevelMap,
  type ModelsDevReasoningOption,
} from "../models-dev-reasoning-options.ts";
import {
  getModelsDevCost,
  modelsDevModel,
  type ModelsDevSource,
  type ThinkingLevelMap,
  toolModels,
} from "./models-dev.ts";

const ZAI_TOOL_STREAM_UNSUPPORTED_MODELS = new Set([
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.5-flash",
  "glm-4.5v",
]);

const ZAI_VARIANTS = [
  {
    source: "zai-coding-plan",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
  },
  {
    source: "zhipuai-coding-plan",
    provider: "zai-coding-cn",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  },
] as const;

function zaiCompat(id: string, supportsReasoningEffort: boolean): OpenAICompletionsCompat {
  return {
    supportsDeveloperRole: false,
    thinkingFormat: "zai",
    ...(supportsReasoningEffort ? { supportsReasoningEffort: true } : {}),
    ...(ZAI_TOOL_STREAM_UNSUPPORTED_MODELS.has(id) ? {} : { zaiToolStream: true }),
  };
}

export function zaiModels({ data, remember }: ModelsDevSource): Model<Api>[] {
  return ZAI_VARIANTS.flatMap(({ source: sourceKey, provider, baseUrl }) =>
    toolModels(data[sourceKey]).map(([id, source]): Model<Api> => {
      const thinkingLevelMap = getEffortThinkingLevelMap(source.reasoning_options ?? []);
      if (thinkingLevelMap !== undefined && (id === "glm-5.2" || id === "glm-5.2-highspeed"))
        thinkingLevelMap.off = "none";
      remember(provider, id, source);
      return modelsDevModel({
        id,
        source,
        api: "openai-completions",
        provider,
        baseUrl,
        thinkingLevelMap,
        compat: zaiCompat(id, thinkingLevelMap !== undefined),
        overrides: { cost: getModelsDevCost(data["zai"]?.models?.[id]?.cost ?? source.cost) },
      });
    }),
  );
}

const BASETEN_BASE_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: true,
  maxTokensField: "max_tokens",
  supportsStrictMode: true,
  sendSessionAffinityHeaders: true,
  supportsLongCacheRetention: false,
};
const BASETEN_REASONING_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...BASETEN_BASE_COMPAT,
  supportsReasoningEffort: true,
  thinkingFormat: "openai",
};
const BASETEN_TOGGLE_ARGS = { enable_thinking: { $var: "thinking.enabled" } } as const;
const BASETEN_TOGGLE_REASONING_COMPAT: OpenAICompletionsCompat = {
  ...BASETEN_BASE_COMPAT,
  thinkingFormat: "baseten",
  chatTemplateArgs: BASETEN_TOGGLE_ARGS,
};
const BASETEN_TOGGLE_REASONING_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...BASETEN_REASONING_EFFORT_COMPAT,
  thinkingFormat: "baseten",
  chatTemplateArgs: BASETEN_TOGGLE_ARGS,
};
const BASETEN_TOGGLE_THINKING_LEVEL_MAP = {
  off: "off",
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: null,
} as const;
const BASETEN_GLM52_THINKING_LEVEL_MAP = {
  off: "none",
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
} as const;

interface BasetenReasoning {
  readonly compat: OpenAICompletionsCompat;
  readonly thinkingLevelMap: ThinkingLevelMap | undefined;
}

function basetenReasoning(
  isGlm52: boolean,
  reasoningOptions: readonly ModelsDevReasoningOption[],
): BasetenReasoning {
  const supportsToggle = reasoningOptions.some((option) => option.type === "toggle") || isGlm52;
  const supportsEffort = reasoningOptions.some((option) => option.type === "effort") || isGlm52;
  const compat =
    supportsToggle && supportsEffort
      ? BASETEN_TOGGLE_REASONING_EFFORT_COMPAT
      : supportsToggle
        ? BASETEN_TOGGLE_REASONING_COMPAT
        : supportsEffort
          ? BASETEN_REASONING_EFFORT_COMPAT
          : BASETEN_BASE_COMPAT;
  const thinkingLevelMap = isGlm52
    ? BASETEN_GLM52_THINKING_LEVEL_MAP
    : supportsToggle
      ? BASETEN_TOGGLE_THINKING_LEVEL_MAP
      : getEffortThinkingLevelMap(reasoningOptions);
  return { compat, thinkingLevelMap };
}

export function basetenModels({ data }: ModelsDevSource): Model<Api>[] {
  return Object.entries(data["baseten"]?.models ?? {})
    .filter(([, source]) => source.status !== "deprecated")
    .map(([id, source]) => {
      const isGlm52 = id === "zai-org/GLM-5.2" || id === "zai-org/GLM-5.2-Fast";
      const { compat, thinkingLevelMap } = basetenReasoning(
        isGlm52,
        source.reasoning_options ?? [],
      );
      const supportsImageInput = !isGlm52 && source.modalities?.input?.includes("image") === true;
      return modelsDevModel({
        id,
        source,
        api: "openai-completions",
        provider: "baseten",
        baseUrl: "https://inference.baseten.co/v1",
        thinkingLevelMap,
        compat,
        overrides: { input: supportsImageInput ? ["text", "image"] : ["text"] },
      });
    });
}
