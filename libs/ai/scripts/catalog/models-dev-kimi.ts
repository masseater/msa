import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import {
  type ModelsDevModel,
  modelsDevFields,
  modelsDevModel,
  type ModelsDevSource,
  toolModels,
} from "./models-dev.ts";

const KIMI_K3_COST = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 0,
} as const;

const KIMI_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  thinkingFormat: "deepseek",
};

const KIMI_K3_OPENAI_COMPAT: OpenAICompletionsCompat = {
  ...KIMI_OPENAI_COMPAT,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "openai",
  supportsReasoningEffort: true,
};

const KIMI_CODING_IMPLIED_COSTS: Record<string, Model<Api>["cost"]> = {
  k3: KIMI_K3_COST,
  "kimi-for-coding": { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
  "kimi-for-coding-highspeed": { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
};

const KIMI_CODING_K3_STYLE_MODEL_IDS = new Set(["k3", "k3-256k", "kimi-for-coding"]);

function kimiCodingModel([id, source]: readonly [
  string,
  ModelsDevModel,
]): Model<"openai-completions"> {
  const isK3Style = KIMI_CODING_K3_STYLE_MODEL_IDS.has(id);
  const impliedCost = KIMI_CODING_IMPLIED_COSTS[id];
  const effortLevels =
    isK3Style && source.reasoning_options !== undefined
      ? getEffortThinkingLevelMap(source.reasoning_options)
      : undefined;
  return {
    ...modelsDevFields({ id, source }),
    api: "openai-completions",
    provider: "kimi-coding",
    baseUrl: "https://api.kimi.com/coding/v1",
    compat: {
      ...(isK3Style ? KIMI_K3_OPENAI_COMPAT : KIMI_OPENAI_COMPAT),
      supportsMidConvoSystemMessages: true,
      ...(isK3Style ? { supportsMidConvoToolAdditions: true } : {}),
    },
    cost: {
      input: source.cost?.input || impliedCost?.input || 0,
      output: source.cost?.output || impliedCost?.output || 0,
      cacheRead: source.cost?.cache_read || impliedCost?.cacheRead || 0,
      cacheWrite: source.cost?.cache_write || impliedCost?.cacheWrite || 0,
    },
    thinkingLevelMap: { ...effortLevels, off: null },
  };
}

export function kimiCodingModels({ data }: ModelsDevSource): Model<Api>[] {
  return toolModels(data["kimi-code-plan-global"]).map(kimiCodingModel);
}

const MOONSHOT_VARIANTS = [
  { key: "moonshotai", provider: "moonshotai", baseUrl: "https://api.moonshot.ai/v1" },
  { key: "moonshotai-cn", provider: "moonshotai-cn", baseUrl: "https://api.moonshot.cn/v1" },
] as const;

export function moonshotModels({ data, remember }: ModelsDevSource): Model<Api>[] {
  return MOONSHOT_VARIANTS.flatMap(({ key, provider, baseUrl }) =>
    toolModels(data[key]).map(([id, source]): Model<Api> => {
      const isKimiK3 = id === "kimi-k3";
      remember(provider, id, source);
      return modelsDevModel({
        id,
        source,
        api: "openai-completions",
        provider,
        baseUrl,
        compat: Object.assign({}, isKimiK3 ? KIMI_K3_OPENAI_COMPAT : KIMI_OPENAI_COMPAT),
        overrides: {
          reasoning: isKimiK3 || source.reasoning === true,
          cost: isKimiK3
            ? Object.assign({}, KIMI_K3_COST)
            : {
                input: source.cost?.input || 0,
                output: source.cost?.output || 0,
                cacheRead: source.cost?.cache_read || 0,
                cacheWrite: source.cost?.cache_write || 0,
              },
        },
      });
    }),
  );
}
