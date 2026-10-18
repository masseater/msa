import { CLOUDFLARE_WORKERS_AI_REST_BASE_URL } from "../../src/api/cloudflare.ts";
import type { ClassifierModel, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import { DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP } from "./thinking-maps.ts";

export const DEEPSEEK_COMPAT = {
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
} satisfies OpenAICompletionsCompat;

export const DEEPSEEK_MODELS: Model<"openai-completions">[] = [
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    provider: "deepseek",
    reasoning: true,
    thinkingLevelMap: DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP,
    input: ["text", "image"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 384000,
    compat: DEEPSEEK_COMPAT,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    provider: "deepseek",
    reasoning: true,
    input: ["text"],
    cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 384000,
    compat: DEEPSEEK_COMPAT,
  },
];

const ANT_LING_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsLongCacheRetention: false,
};

const antLingModel = (
  fields: Pick<Model<"openai-completions">, "id" | "name" | "reasoning" | "cost">,
): Model<"openai-completions"> => ({
  ...fields,
  api: "openai-completions",
  baseUrl: "https://api.ant-ling.com/v1",
  provider: "ant-ling",
  input: ["text"],
  contextWindow: 262144,
  maxTokens: 65536,
  compat: fields.reasoning ? { ...ANT_LING_COMPAT, thinkingFormat: "ant-ling" } : ANT_LING_COMPAT,
});

export const ANT_LING_MODELS: Model<"openai-completions">[] = [
  antLingModel({
    id: "Ling-2.6-flash",
    name: "Ling 2.6 Flash",
    reasoning: false,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 },
  }),
  antLingModel({
    id: "Ling-2.6-1T",
    name: "Ling 2.6 1T",
    reasoning: false,
    cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
  }),
  antLingModel({
    id: "Ring-2.6-1T",
    name: "Ring 2.6 1T",
    reasoning: true,
    cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
  }),
];

const MISTRAL_MEDIUM_THINKING_LEVEL_MAP = getEffortThinkingLevelMap([
  { type: "effort", values: ["none", "high"] },
]);

export const FALLBACK_MODELS: Model<any>[] = [
  {
    id: "mistral-medium-3.5",
    name: "Mistral Medium 3.5",
    api: "mistral-conversations",
    provider: "mistral",
    baseUrl: "https://api.mistral.ai",
    reasoning: true,
    ...(MISTRAL_MEDIUM_THINKING_LEVEL_MAP === undefined
      ? {}
      : { thinkingLevelMap: MISTRAL_MEDIUM_THINKING_LEVEL_MAP }),
    input: ["text", "image"],
    cost: { input: 1.5, output: 7.5, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    id: "auto",
    name: "Auto",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 2000000,
    maxTokens: 30000,
  },
  {
    id: "openrouter/fusion",
    name: "OpenRouter: Fusion",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 30000,
  },
];

export const OPENCODE_CLASSIFIER_MODELS: ClassifierModel<"typesafe-system-one">[] = [
  {
    type: "classifier",
    id: "jev-1.13",
    name: "Jev 1.13",
    api: "typesafe-system-one",
    provider: "opencode",
    baseUrl: "https://opencode.ai/inference/v1",
    input: ["text"],
    cost: { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
  },
  {
    type: "classifier",
    id: "jev-1.13-free",
    name: "Jev 1.13 Free",
    api: "typesafe-system-one",
    provider: "opencode",
    baseUrl: "https://opencode.ai/inference/v1",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
  },
];

export const CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS: ClassifierModel<"cloudflare-workers-ai-system-one">[] =
  [
    {
      type: "classifier",
      id: "@cf/cloudflare/clef",
      name: "Clef",
      api: "cloudflare-workers-ai-system-one",
      provider: "cloudflare-workers-ai",
      baseUrl: CLOUDFLARE_WORKERS_AI_REST_BASE_URL,
      input: ["text"],
      cost: { input: 0.24, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 65536,
    },
    {
      type: "classifier",
      id: "@cf/cloudflare/clef-flash",
      name: "Clef Flash",
      api: "cloudflare-workers-ai-system-one",
      provider: "cloudflare-workers-ai",
      baseUrl: CLOUDFLARE_WORKERS_AI_REST_BASE_URL,
      input: ["text"],
      cost: { input: 0.09, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 65536,
    },
    {
      type: "classifier",
      id: "typesafe/jev",
      name: "Jev",
      api: "cloudflare-workers-ai-system-one",
      provider: "cloudflare-workers-ai",
      baseUrl: CLOUDFLARE_WORKERS_AI_REST_BASE_URL,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
    },
  ];
