import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";

import {
  CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL,
  CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
  CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL,
  CLOUDFLARE_WORKERS_AI_BASE_URL,
  CLOUDFLARE_WORKERS_AI_REST_BASE_URL,
} from "../src/api/cloudflare.ts";
import {
  DEFAULT_RADIUS_GATEWAY,
  getRadiusModelsFromConfig,
  loadRadiusGatewayConfig,
} from "../src/providers/radius-config.ts";
import type {
  AnthropicMessagesCompat,
  AnyModel,
  Api,
  ClassifierApi,
  ClassifierModel,
  ImageApi,
  ImageModel,
  Model,
  ModelCost,
  ModelPromptCache,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "../src/types.ts";
import { type AiGatewayPricing, getAiGatewayCost } from "./ai-gateway-pricing.ts";
import {
  assertExactModelIds,
  createModelDataManifest,
  groupProviderModelData,
  type ModelCatalogEntry,
  type ModelDataStructure,
  MODEL_DATA_MANIFEST_FILE,
  readModelDataProviderIds,
  validateGeneratedModelData,
  validateModelDataDirectory,
} from "./model-data.ts";
import {
  getEffortThinkingLevelMap,
  type ModelsDevReasoningOption,
} from "./models-dev-reasoning-options.ts";
import {
  buildOpenRouterCatalog,
  type OpenRouterCatalog,
  type OpenRouterModelListItem,
} from "./openrouter-catalog.ts";

const packageRoot = join(import.meta.dirname, "..");

function readGeneratorOptions(args: string[]): {
  strict: boolean;
  dataOnly: boolean;
  jsonOnly: boolean;
  jsonOutputDir: string | undefined;
  pretty: boolean;
} {
  let strict = false;
  let dataOnly = false;
  let jsonOnly = false;
  let jsonOutputDir: string | undefined;
  let pretty = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--data-only") {
      dataOnly = true;
      continue;
    }
    if (arg === "--json-only") {
      jsonOnly = true;
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (arg === "--json-output") {
      const value = args[++index];
      if (value === undefined || value === "")
        throw new Error("--json-output requires a directory");
      jsonOutputDir = resolve(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (jsonOnly && (jsonOutputDir === undefined || jsonOutputDir === ""))
    throw new Error("--json-only requires --json-output");
  if (dataOnly && (jsonOnly || jsonOutputDir))
    throw new Error("--data-only cannot be combined with JSON catalog output");
  return { strict, dataOnly, jsonOnly, jsonOutputDir, pretty };
}

const generatorOptions = readGeneratorOptions(process.argv.slice(2));

interface ModelsDevModel {
  id: string;
  name: string;
  tool_call?: boolean;
  structured_output?: boolean;
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
  status?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: {
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tier?: {
        type?: string;
        size?: number;
      };
    }[];
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  provider?: {
    npm?: string;
  };
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

interface ModelsDevMetadata {
  id: string;
  type?: string;
  name: string;
  limit?: { context?: number };
  modalities?: { input?: string[] };
}

type ModelsDevCatalog = Record<string, ModelsDevProvider>;

interface NvidiaNimModelListItem {
  id: string;
}

interface AiGatewayModel {
  id: string;
  name?: string;
  type?: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  pricing?: AiGatewayPricing;
}

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
const TOGETHER_REASONING_ONLY_MODELS = new Set([
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

const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1";
const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
const AI_GATEWAY_TYPESAFE_BASE_URL = "https://ai-gateway.vercel.sh/typesafe/v1";
const VERTEX_BASE_URL = "https://{location}-aiplatform.googleapis.com";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_HEADERS = {
  "NVCF-POLL-SECONDS": "3600",
} as const;
const NVIDIA_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};
const NVIDIA_NIM_UNSUPPORTED_MODELS = new Set([
  "abacusai/dracarys-llama-3.1-70b-instruct",
  "bytedance/seed-oss-36b-instruct",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "google/gemma-2-2b-it",
  "google/gemma-3n-e2b-it",
  "google/gemma-3n-e4b-it",
  "google/gemma-4-31b-it",
  "meta/llama-3.2-1b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "microsoft/phi-4-mini-instruct",
  "minimaxai/minimax-m2.7",
  "mistralai/mistral-nemotron",
  "nvidia/nemotron-mini-4b-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3.5-397b-a17b",
  "sarvamai/sarvam-m",
  "upstage/solar-10.7b-instruct",
]);
const ZAI_TOOL_STREAM_UNSUPPORTED_MODELS = new Set([
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.5-flash",
  "glm-4.5v",
]);
const OPENCODE_GO_GLM52_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
} as const;
const ANTHROPIC_ALLOWED_FALLBACK_MODELS = {
  "claude-fable-5": ["claude-opus-4-8", "claude-opus-5"],
  "claude-opus-5": ["claude-opus-4-8"],
} satisfies Record<string, string[]>;

const DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
} as const;
const DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP = {
  ...DEEPSEEK_V4_THINKING_LEVEL_MAP,
  low: "low",
} as const;
const AZURE_DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
} as const;
const FIREWORKS_ADAPTIVE_THINKING_FALLBACK_MODELS = new Set([
  "accounts/fireworks/models/deepseek-v4-flash-0731",
  "accounts/fireworks/models/deepseek-v4-flash-vision-exp",
  "accounts/fireworks/models/deepseek-v4-pro-0813",
  "accounts/fireworks/models/qwen3p8-max",
  "accounts/fireworks/models/qwen3p8-2p4t-a95b",
]);
const QWEN_TOKEN_PLAN_FALLBACK_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
} as const;
const QWEN_TOKEN_PLAN_REASONING_EFFORT_FALLBACK_MODEL_IDS = new Set(["glm-5", "glm-5.1"]);
const QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS = new Set(["qwen3.8-max-preview"]);
const QWEN_TOKEN_PLAN_PROVIDER_IDS = new Set<string>([
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "qwen-token-plan-individual",
]);
const QWEN_TOKEN_PLAN_INDIVIDUAL_MODEL_IDS = new Set<string>([
  "deepseek-v4-flash-0731",
  "deepseek-v4-pro",
  "deepseek-v4-pro-0813",
  "glm-5.2",
  "qwen3.6-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.8-flash",
  "qwen3.8-max",
]);

const KIMI_K3_MAX_TOKENS = 131072;
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
const OPENROUTER_KIMI_K3_MODEL_IDS = new Set(["moonshotai/kimi-k3", "~moonshotai/kimi-latest"]);

const ANT_LING_RING_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: "xhigh",
} as const;

const BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS = new Set(["anthropic.claude-opus-5"]);
const MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS = new Set(["gpt-5.6"]);
const OPENAI_TOOL_SEARCH_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);
const OPENAI_ADDITIONAL_TOOLS_MODEL_IDS = OPENAI_TOOL_SEARCH_MODEL_IDS;
const OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS = OPENAI_TOOL_SEARCH_MODEL_IDS;
const OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);
const OPENAI_MID_CONVO_EFFORT_MODEL_IDS = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);
const OPENAI_LONG_CONTEXT_INPUT_THRESHOLD = 272000;
const OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);
const OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

const DEFAULT_IMAGE_RESIZE = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 4.5 * 1024 * 1024,
  jpegQuality: 80,
} as const;

function withOpenAiLongContextPricing(cost: Model<Api>["cost"]): Model<Api>["cost"] {
  return {
    ...cost,
    tiers: [
      {
        inputTokensAbove: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
        input: roundCost(cost.input * 2),
        output: roundCost(cost.output * 1.5),
        cacheRead: roundCost(cost.cacheRead * 2),
        cacheWrite: roundCost(cost.cacheWrite * 2),
      },
    ],
  };
}

const OPENAI_STANDARD_COSTS = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
} satisfies Record<string, ModelCost>;
const OPENAI_STANDARD_COSTS_BY_ID: Readonly<Record<string, ModelCost>> = OPENAI_STANDARD_COSTS;

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
const XAI_BUILTIN_EXCLUDED_MODEL_IDS = new Set([
  "grok-3",
  "grok-3-fast",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-build-0.1",
  "grok-code-fast-1",
]);
const XAI_RESPONSES_COMPAT: OpenAIResponsesCompat = {
  supportsLongCacheRetention: false,
};

const OPENCODE_OPENAI_COMPLETIONS_LONG_CACHE_RETENTION_UNSUPPORTED_MODELS = new Set([
  "opencode:deepseek-v4-flash",
  "opencode:deepseek-v4-pro",
  "opencode:kimi-k2.5",
  "opencode:kimi-k2.6",
  "opencode:minimax-m2.7",
  "opencode-go:kimi-k2.6",
]);

function mergeThinkingLevelMap(
  model: Model<any>,
  map: NonNullable<Model<any>["thinkingLevelMap"]>,
): void {
  model.thinkingLevelMap = { ...model.thinkingLevelMap, ...map };
}

const modelsDevReasoningOptions = new Map<string, ModelsDevReasoningOption[]>();

function getModelKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}:${model.id}`;
}

function recordModelsDevReasoningOptions(
  provider: string,
  id: string,
  sourceModel: ModelsDevModel,
): void {
  if (sourceModel.reasoning_options !== undefined) {
    modelsDevReasoningOptions.set(`${provider}:${id}`, sourceModel.reasoning_options);
  }
}

function supportsDirectReasoningEffort(model: Model<Api>): boolean {
  if (model.api === "anthropic-messages") {
    return (model.compat as AnthropicMessagesCompat | undefined)?.forceAdaptiveThinking === true;
  }
  if (
    model.api === "openai-responses" ||
    model.api === "azure-openai-responses" ||
    model.api === "openai-codex-responses"
  ) {
    return true;
  }
  if (model.api !== "openai-completions") return false;

  const compat = {
    ...detectOpenAICompletionsCompat(model as Model<"openai-completions">),
    ...(model.compat as OpenAICompletionsCompat | undefined),
  };
  return compat.thinkingFormat === "openai" && compat.supportsReasoningEffort;
}

function applyModelsDevReasoningOptionMetadata(model: Model<Api>): void {
  const reasoningOptions = modelsDevReasoningOptions.get(getModelKey(model));
  if (reasoningOptions === undefined || !supportsDirectReasoningEffort(model)) return;
  const thinkingLevelMap = getEffortThinkingLevelMap(reasoningOptions);
  if (thinkingLevelMap !== undefined) mergeThinkingLevelMap(model, thinkingLevelMap);
}

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
): NonNullable<Model<any>["thinkingLevelMap"]> | undefined {
  if (!reasoning) return undefined;
  if (TOGETHER_REASONING_EFFORT_MODELS.has(modelId))
    return { ...TOGETHER_REASONING_EFFORT_LEVEL_MAP };
  if (TOGETHER_TOGGLE_REASONING_EFFORT_MODELS.has(modelId))
    return { ...TOGETHER_DEEPSEEK_V4_THINKING_LEVEL_MAP };
  if (TOGETHER_REASONING_ONLY_MODELS.has(modelId)) return { ...TOGETHER_FIXED_REASONING_LEVEL_MAP };
  return { ...TOGETHER_TOGGLE_REASONING_LEVEL_MAP };
}

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

function supportsOpenAiMax(model: Model<Api>): boolean {
  return (
    (model.id.includes("gpt-5.6") || model.id.includes("gpt-6")) &&
    (model.api === "openai-responses" ||
      model.api === "azure-openai-responses" ||
      model.api === "openai-codex-responses" ||
      model.api === "openai-completions")
  );
}

const VERIFIED_ANTHROPIC_MID_CONVO_EFFORT_PROVIDERS = new Set(["anthropic", "openrouter"]);
const MID_CONVO_EFFORT_UNSUPPORTED_ANTHROPIC_MODELS = new Set([
  "openrouter:anthropic/claude-opus-5",
]);

function supportsAnthropicMidConvoEffort(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^~?anthropic\//u, "");
  return (
    /^claude-opus-(?:5|5[.-]5)(?:-\d{8})?$/u.test(id) ||
    /^claude-(?:sonnet|haiku)-5[.-]5(?:-\d{8})?$/u.test(id) ||
    /^claude-(?:fable|mythos)-5(?:[.-]1)(?:-\d{8})?$/u.test(id)
  );
}

const ANTHROPIC_DISABLED_THINKING_MODELS = new Set([
  "claude-opus-5",
  "claude-haiku-5-5",
  "claude-haiku-5.5",
]);

function supportsAnthropicDisabledThinkingWithMidConvoEffort(modelId: string): boolean {
  const id = modelId
    .toLowerCase()
    .replace(/^~?anthropic\//u, "")
    .replace(/-\d{8}$/u, "");
  return ANTHROPIC_DISABLED_THINKING_MODELS.has(id);
}

function supportsAnthropicMidConvoSystemMessages(modelId: string): boolean {
  return (
    /^claude-opus-(?:4[.-]8|5(?:[.-]5)?)(?:-\d{8})?$/u.test(modelId) ||
    /^claude-(?:sonnet|haiku)-5[.-]5(?:-\d{8})?$/u.test(modelId) ||
    /^claude-(?:fable|mythos)-5(?:[.-]1)?(?:-\d{8})?$/u.test(modelId)
  );
}

function isAnthropicAdaptiveThinkingModel(modelId: string): boolean {
  return (
    modelId.includes("opus-4-6") ||
    modelId.includes("opus-4.6") ||
    modelId.includes("opus-4-7") ||
    modelId.includes("opus-4.7") ||
    modelId.includes("opus-4-8") ||
    modelId.includes("opus-4.8") ||
    modelId.includes("opus-5") ||
    modelId.includes("opus.5") ||
    modelId.includes("sonnet-4-6") ||
    modelId.includes("sonnet-4.6") ||
    modelId.includes("sonnet-5") ||
    modelId.includes("sonnet.5") ||
    modelId.includes("haiku-5") ||
    modelId.includes("haiku.5") ||
    modelId.includes("fable-5") ||
    modelId.includes("mythos-5")
  );
}

function isAnthropicTemperatureUnsupportedModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes("opus-4-7") ||
    id.includes("opus-4.7") ||
    id.includes("opus-4-8") ||
    id.includes("opus-4.8") ||
    id.includes("opus-5") ||
    id.includes("opus.5") ||
    id.includes("sonnet-5-5") ||
    id.includes("sonnet-5.5") ||
    id.includes("haiku-5-5") ||
    id.includes("haiku-5.5")
  );
}

type OpenAICompletionsResolvedCompat = Required<
  Omit<
    OpenAICompletionsCompat,
    | "cacheControlFormat"
    | "sessionAffinityFormat"
    | "supportsThinkingTokenBudget"
    | "thinkingTokenBudgetField"
    | "vllmPriority"
  >
> & {
  cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
};

const OPENAI_COMPLETIONS_DEFAULT_COMPAT: OpenAICompletionsResolvedCompat = {
  supportsStore: true,
  supportsDeveloperRole: true,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  supportsFinishReason: true,
  maxTokensField: "max_completion_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  thinkingFormat: "openai",
  openRouterRouting: {},
  vercelGatewayRouting: {},
  chatTemplateKwargs: {},
  chatTemplateArgs: {},
  zaiToolStream: false,
  supportsStrictMode: false,
  supportsOpenAIGrammarTools: false,
  supportsMidConvoSystemMessages: false,
  supportsMidConvoToolAdditions: false,
  sendSessionAffinityHeaders: false,
  supportsLongCacheRetention: true,
};

function mergeAnthropicMessagesCompat(model: Model<Api>, compat: AnthropicMessagesCompat): void {
  model.compat = { ...(model.compat as AnthropicMessagesCompat | undefined), ...compat };
}

function detectOpenAICompletionsCompat(
  model: Model<"openai-completions">,
): OpenAICompletionsResolvedCompat {
  const provider = model.provider;
  const baseUrl = model.baseUrl;

  const isZai =
    provider === "zai" ||
    provider === "zai-coding-cn" ||
    baseUrl.includes("api.z.ai") ||
    baseUrl.includes("open.bigmodel.cn");
  const isTogether =
    provider === "together" ||
    baseUrl.includes("api.together.ai") ||
    baseUrl.includes("api.together.xyz");
  const isMoonshot =
    provider === "moonshotai" || provider === "moonshotai-cn" || baseUrl.includes("api.moonshot.");
  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");
  const isCloudflareWorkersAI =
    provider === "cloudflare-workers-ai" || baseUrl.includes("api.cloudflare.com");
  const isCloudflareAiGateway =
    provider === "cloudflare-ai-gateway" || baseUrl.includes("gateway.ai.cloudflare.com");
  const isNvidia = provider === "nvidia" || baseUrl.includes("integrate.api.nvidia.com");
  const isAntLing = provider === "ant-ling" || baseUrl.includes("api.ant-ling.com");
  const isCerebras = provider === "cerebras" || baseUrl.includes("cerebras.ai");
  const isTogetherReasoningOnly = isTogether && TOGETHER_REASONING_ONLY_MODELS.has(model.id);
  const isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com");

  const isNonStandard =
    isNvidia ||
    isCerebras ||
    provider === "xai" ||
    baseUrl.includes("api.x.ai") ||
    isTogether ||
    baseUrl.includes("chutes.ai") ||
    isDeepSeek ||
    isZai ||
    isMoonshot ||
    provider === "opencode" ||
    baseUrl.includes("opencode.ai") ||
    isCloudflareWorkersAI ||
    isCloudflareAiGateway ||
    isAntLing;

  const useMaxTokens =
    baseUrl.includes("chutes.ai") ||
    isDeepSeek ||
    isMoonshot ||
    isCloudflareAiGateway ||
    isTogether ||
    isNvidia ||
    isAntLing ||
    isZai;

  const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");
  const isOpenRouterDeveloperRoleModel =
    isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));
  const cacheControlFormat =
    provider === "openrouter" && /^~?anthropic\//u.test(model.id) ? "anthropic" : undefined;

  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter),
    supportsReasoningEffort:
      !isGrok &&
      !isZai &&
      !isMoonshot &&
      !isTogether &&
      !isCloudflareAiGateway &&
      !isNvidia &&
      !isAntLing,
    supportsUsageInStreaming: true,
    supportsFinishReason: true,
    maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: isDeepSeek,
    thinkingFormat: isDeepSeek
      ? "deepseek"
      : isZai
        ? "zai"
        : isTogether && !isTogetherReasoningOnly
          ? "together"
          : isAntLing
            ? "ant-ling"
            : isOpenRouter
              ? "openrouter"
              : "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    chatTemplateKwargs: {},
    chatTemplateArgs: {},
    zaiToolStream: false,
    supportsStrictMode:
      !isMoonshot && !isTogether && !isCloudflareAiGateway && !isNvidia && !isCerebras,
    supportsOpenAIGrammarTools: false,
    supportsMidConvoSystemMessages: false,
    supportsMidConvoToolAdditions: false,
    ...(cacheControlFormat === undefined ? {} : { cacheControlFormat }),
    sendSessionAffinityHeaders: isOpenRouter,
    supportsLongCacheRetention: !(
      isTogether ||
      isCloudflareWorkersAI ||
      isCloudflareAiGateway ||
      isNvidia ||
      isAntLing
    ),
  };
}

function isPlainEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function openAICompletionsCompatDelta(
  compat: OpenAICompletionsResolvedCompat,
): OpenAICompletionsCompat {
  const delta: OpenAICompletionsCompat = {};
  for (const [key, value] of Object.entries(compat)) {
    const defaultValue =
      OPENAI_COMPLETIONS_DEFAULT_COMPAT[key as keyof typeof OPENAI_COMPLETIONS_DEFAULT_COMPAT];
    if (isPlainEmptyObject(value) && isPlainEmptyObject(defaultValue)) continue;
    if (value !== defaultValue) {
      (delta as Record<string, unknown>)[key] = value;
    }
  }
  return delta;
}

function applyOpenAICompletionsCompatMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;
  const detected = openAICompletionsCompatDelta(
    detectOpenAICompletionsCompat(model as Model<"openai-completions">),
  );
  model.compat = { ...detected, ...(model.compat as OpenAICompletionsCompat | undefined) };
  if (Object.keys(model.compat).length === 0) {
    delete model.compat;
  }
}

function applyAnthropicMessagesCompatMetadata(model: Model<Api>): void {
  if (model.api !== "anthropic-messages") return;
  const compat = getAnthropicMessagesCompat(model.provider, model.id);
  if (compat !== undefined) {
    mergeAnthropicMessagesCompat(model, compat);
    if (
      compat.supportsMidConvoEffort === true &&
      !supportsAnthropicDisabledThinkingWithMidConvoEffort(model.id)
    ) {
      mergeThinkingLevelMap(model, { off: null });
    }
  }
}

function isAnthropicFallbackMetadataModel(model: Model<Api>): model is Model<"anthropic-messages"> {
  if (model.provider !== "anthropic" || model.api !== "anthropic-messages") return false;
  return (
    model.id in ANTHROPIC_ALLOWED_FALLBACK_MODELS ||
    Object.values(ANTHROPIC_ALLOWED_FALLBACK_MODELS).some((fallbackModelIds) =>
      fallbackModelIds.includes(model.id),
    )
  );
}

function applyAnthropicAllowedFallbackModelMetadata(
  models: readonly Model<"anthropic-messages">[],
): void {
  const modelsById = new Map(models.map((model) => [model.id, model]));
  for (const [modelId, fallbackModelIds] of Object.entries(ANTHROPIC_ALLOWED_FALLBACK_MODELS)) {
    const model = modelsById.get(modelId);
    if (model === undefined) continue;

    const compatibleFallbackModelIds =
      model.compat?.supportsMidConvoEffort === true
        ? fallbackModelIds.filter(supportsAnthropicMidConvoEffort)
        : fallbackModelIds;
    const allowedFallbackModels = compatibleFallbackModelIds.flatMap((fallbackModelId) => {
      const fallbackModel = modelsById.get(fallbackModelId);
      return fallbackModel === undefined
        ? []
        : [{ provider: fallbackModel.provider, model: fallbackModel.id, cost: fallbackModel.cost }];
    });
    if (allowedFallbackModels.length > 0) {
      mergeAnthropicMessagesCompat(model, { allowedFallbackModels });
    }
  }
}

function applyStrictToolCompatMetadata(model: Model<Api>): void {
  if (
    (model.provider === "openai" || model.provider === "cloudflare-ai-gateway") &&
    model.api === "openai-responses"
  ) {
    model.compat = {
      ...(model.compat as OpenAIResponsesCompat | undefined),
      supportsStrictMode: true,
    };
  } else if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    mergeAnthropicMessagesCompat(model, { supportsStrictTools: true });
  }
}

const OPENAI_GRAMMAR_TOOL_PROVIDERS = new Set([
  "openai",
  "openai-codex",
  "azure",
  "opencode",
  "cloudflare-ai-gateway",
]);
const OPENAI_GRAMMAR_TOOL_APIS = new Set<Api>([
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);

function applyOpenAIGrammarToolCompatMetadata(model: Model<Api>): void {
  if (
    !OPENAI_GRAMMAR_TOOL_APIS.has(model.api) ||
    !OPENAI_GRAMMAR_TOOL_PROVIDERS.has(model.provider)
  )
    return;
  const match = /^gpt-(\d+)/u.exec(model.id);
  if (match === null || Number(match[1]) < 5) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsOpenAIGrammarTools: true,
  };
}

function applyOpenAIToolSearchMetadata(model: Model<Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";
  if (!(isOpenAIResponses || isOpenAICodex) || !OPENAI_TOOL_SEARCH_MODEL_IDS.has(model.id)) return;
  const supportsAdditionalTools =
    (isOpenAIResponses && OPENAI_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id)) ||
    (isOpenAICodex && OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id));
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    ...(supportsAdditionalTools ? { supportsAdditionalTools: true } : {}),
    supportsToolSearch: true,
  };
}

function applyOpenAICompletionsTranscriptMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;
  const isKimiK3 =
    (model.provider.startsWith("moonshot") && model.id === "kimi-k3") ||
    (model.provider === "fireworks" && model.id.includes("kimi-k3")) ||
    ((model.provider === "opencode" || model.provider === "opencode-go") && model.id === "kimi-k3");
  const isMoonshotKimiK2 =
    model.provider.startsWith("moonshot") &&
    (model.id === "kimi-k2.6" ||
      model.id === "kimi-k2.7-code" ||
      model.id === "kimi-k2.7-code-highspeed");
  const isTextOnly =
    isMoonshotKimiK2 ||
    (model.provider === "deepseek" && model.id === "deepseek-v4-pro") ||
    (model.provider === "openrouter" &&
      model.id.startsWith("openai/") &&
      OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id.slice("openai/".length)));
  if (!isKimiK3 && !isTextOnly) return;
  model.compat = {
    ...(model.compat as OpenAICompletionsCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isKimiK3 ? { supportsMidConvoToolAdditions: true } : {}),
  };
}

const OPENAI_RESPONSES_PROXY_PROVIDERS = new Set(["opencode", "opencode-go"]);

function applyOpenAIResponsesTranscriptMetadata(model: Model<Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";
  const isProxiedResponses =
    OPENAI_RESPONSES_PROXY_PROVIDERS.has(model.provider) && model.api === "openai-responses";
  if (
    !(isOpenAIResponses || isOpenAICodex || isProxiedResponses) ||
    !OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id)
  ) {
    return;
  }
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isProxiedResponses ? { supportsAdditionalTools: true } : {}),
  };
}

function applyOpenAIExplicitPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!(model.cost.cacheWrite > 0)) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsExplicitPromptCacheMode: true,
  };
}

function applyOpenAIMidConvoEffortMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!OPENAI_MID_CONVO_EFFORT_MODEL_IDS.has(model.id)) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsMidConvoEffort: true,
  };
}

const ANTHROPIC_PROMPT_CACHE: ModelPromptCache = { short: 300, long: 3600 };

function applyPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    model.promptCache = ANTHROPIC_PROMPT_CACHE;
  }
}

function applyImageInputMetadata(model: AnyModel): void {
  if (!model.input.includes("image")) return;

  const providerLimits: AnyModel["inputLimits"] =
    model.provider === "anthropic"
      ? {
          maxRequestBytes: 32 * 1024 * 1024,
          images: {
            maxPerRequest: model.type !== "image" && model.contextWindow === 200000 ? 100 : 600,
          },
        }
      : model.provider === "amazon-bedrock"
        ? { images: { maxPerMessage: 20 } }
        : model.provider === "openai"
          ? { maxRequestBytes: 512 * 1024 * 1024, images: { maxPerRequest: 1500 } }
          : model.provider === "google"
            ? { maxRequestBytes: 20 * 1024 * 1024, images: { maxPerRequest: 3600 } }
            : undefined;
  const configuredImages = model.inputLimits?.images;
  model.inputLimits = {
    ...providerLimits,
    ...model.inputLimits,
    images: {
      ...providerLimits?.images,
      ...configuredImages,
      resize: { ...DEFAULT_IMAGE_RESIZE, ...configuredImages?.resize },
    },
  };
}

function isGemma4Model(modelId: string): boolean {
  return /gemma-?4/u.test(modelId.toLowerCase());
}

function getGoogleThinkingLevelMap(
  modelId: string,
  reasoningOptions: readonly ModelsDevReasoningOption[],
): NonNullable<Model<Api>["thinkingLevelMap"]> | undefined {
  const effortMap = getEffortThinkingLevelMap(reasoningOptions);
  if (effortMap !== undefined) return effortMap;
  if (isGemma4Model(modelId)) {
    return { off: null, minimal: "MINIMAL", low: null, medium: null, high: "HIGH" };
  }
  return undefined;
}

function applyThinkingLevelMetadata(model: Model<any>): void {
  if (
    (model.api === "openai-responses" || model.api === "azure-openai-responses") &&
    model.id.startsWith("gpt-5")
  ) {
    mergeThinkingLevelMap(model, { off: null });
  }
  if (
    (model.id === "gpt-6-astra" ||
      model.id === "gpt-6-sol" ||
      model.id === "gpt-6-luna" ||
      model.id === "gpt-6.1-sol") &&
    (model.api === "openai-responses" ||
      model.api === "azure-openai-responses" ||
      model.api === "openai-codex-responses")
  ) {
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
  if (supportsOpenAiXhigh(model.id)) {
    mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  }
  if (supportsOpenAiMax(model)) {
    mergeThinkingLevelMap(model, { max: "max" });
  }
  if (model.provider === "openai" && model.id === "gpt-5.5") {
    mergeThinkingLevelMap(model, { minimal: null });
  }
  if (model.id.endsWith("gpt-5.5-pro")) {
    mergeThinkingLevelMap(model, { off: null, minimal: null, low: null });
  }
  if (
    model.id.includes("opus-4-6") ||
    model.id.includes("opus-4.6") ||
    model.id.includes("sonnet-4-6") ||
    model.id.includes("sonnet-4.6")
  ) {
    mergeThinkingLevelMap(model, { max: "max" });
  }
  if (
    model.id.includes("opus-4-7") ||
    model.id.includes("opus-4.7") ||
    model.id.includes("opus-4-8") ||
    model.id.includes("opus-4.8") ||
    model.id.includes("opus-5") ||
    model.id.includes("opus.5") ||
    model.id.includes("sonnet-5") ||
    model.id.includes("sonnet.5") ||
    model.id.includes("haiku-5") ||
    model.id.includes("haiku.5")
  ) {
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
  if (
    model.api === "openai-completions" &&
    model.id.includes("deepseek-v4") &&
    model.thinkingLevelMap === undefined
  ) {
    mergeThinkingLevelMap(
      model,
      model.provider === "openrouter"
        ? { ...DEEPSEEK_V4_THINKING_LEVEL_MAP, xhigh: "xhigh", max: null }
        : model.provider === "azure"
          ? AZURE_DEEPSEEK_V4_THINKING_LEVEL_MAP
          : (model.provider === "deepseek" ||
                model.provider === "opencode" ||
                model.provider === "opencode-go") &&
              model.id.includes("deepseek-v4-flash")
            ? DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP
            : DEEPSEEK_V4_THINKING_LEVEL_MAP,
    );
  }
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
  if (model.provider === "fireworks") {
    if (
      model.api === "anthropic-messages" &&
      (model.compat as AnthropicMessagesCompat | undefined)?.forceAdaptiveThinking === true
    ) {
      if (
        model.id === "accounts/fireworks/models/qwen3p8-max" &&
        model.thinkingLevelMap === undefined
      ) {
        const thinkingLevelMap = getEffortThinkingLevelMap([
          { type: "effort", values: ["low", "medium", "xhigh"] },
        ]);
        if (thinkingLevelMap !== undefined) model.thinkingLevelMap = thinkingLevelMap;
      }
      const reasoningOptions = modelsDevReasoningOptions.get(getModelKey(model));
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
  }
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

function getAnthropicMessagesCompat(
  provider: string,
  modelId: string,
): AnthropicMessagesCompat | undefined {
  const compat: AnthropicMessagesCompat = {};
  if (
    VERIFIED_ANTHROPIC_MID_CONVO_EFFORT_PROVIDERS.has(provider) &&
    supportsAnthropicMidConvoEffort(modelId) &&
    !MID_CONVO_EFFORT_UNSUPPORTED_ANTHROPIC_MODELS.has(`${provider}:${modelId}`)
  ) {
    compat.supportsMidConvoEffort = true;
  }
  if (provider === "anthropic" && supportsAnthropicMidConvoSystemMessages(modelId)) {
    compat.supportsMidConvoSystemMessages = true;
    compat.supportsMidConvoToolChanges = true;
  }
  if (provider === "opencode" && supportsAnthropicMidConvoSystemMessages(modelId)) {
    compat.supportsMidConvoSystemMessages = true;
  }
  if (provider === "xiaomi" || provider.startsWith("xiaomi-token-plan-")) {
    compat.allowEmptySignature = true;
  }
  if ((provider === "opencode" || provider === "opencode-go") && modelId === "qwen3.8-flash") {
    compat.allowEmptySignature = true;
  }
  return Object.keys(compat).length > 0 ? compat : undefined;
}

function getBedrockBaseUrl(modelId: string): string {
  return modelId.startsWith("eu.")
    ? "https://bedrock-runtime.eu-central-1.amazonaws.com"
    : "https://bedrock-runtime.us-east-1.amazonaws.com";
}

function normalizeNvidiaModelId(modelId: string): string {
  return modelId.toLowerCase().replaceAll("_", ".");
}

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

function getModelsDevCost(cost: ModelsDevModel["cost"]): ModelCost {
  const base = {
    input: cost?.input || 0,
    output: cost?.output || 0,
    cacheRead: cost?.cache_read || 0,
    cacheWrite: cost?.cache_write || 0,
  };
  const tiers = cost?.tiers?.flatMap((tier) => {
    const context = tier.tier;
    if (context?.type !== "context" || context.size === undefined) return [];
    return [
      {
        inputTokensAbove: context.size,
        input: tier.input ?? base.input,
        output: tier.output ?? base.output,
        cacheRead: tier.cache_read ?? base.cacheRead,
        cacheWrite: tier.cache_write ?? base.cacheWrite,
      },
    ];
  });

  return tiers !== undefined && tiers.length > 0 ? { ...base, tiers } : base;
}

async function fetchNvidiaNimModelIds(): Promise<Map<string, string>> {
  try {
    console.log("Fetching models from NVIDIA NIM API...");
    const response = await fetch(`${NVIDIA_BASE_URL}/models`);
    if (!response.ok) throw new Error(`NVIDIA NIM API returned ${response.status}`);
    const data = (await response.json()) as { data?: NvidiaNimModelListItem[] };
    const modelIds = new Map<string, string>();

    for (const model of data.data ?? []) {
      modelIds.set(model.id, model.id);
      modelIds.set(normalizeNvidiaModelId(model.id), model.id);
    }

    console.log(`Fetched ${data.data?.length ?? 0} model IDs from NVIDIA NIM`);
    return modelIds;
  } catch (error) {
    console.error("Failed to fetch NVIDIA NIM models:", error);
    if (generatorOptions.strict) throw error;
    return new Map();
  }
}

async function fetchOpenRouterList(query: string): Promise<OpenRouterModelListItem[]> {
  const response = await fetch(`https://openrouter.ai/api/v1/models${query}`);
  if (!response.ok) throw new Error(`OpenRouter API returned ${response.status}`);
  const data = (await response.json()) as { data?: OpenRouterModelListItem[] };
  return data.data ?? [];
}

async function fetchOpenRouterModels(): Promise<OpenRouterCatalog> {
  try {
    console.log("Fetching models from OpenRouter API...");
    const [listed, imageListed, decisionListed] = await Promise.all([
      fetchOpenRouterList(""),
      fetchOpenRouterList("?output_modalities=image"),
      fetchOpenRouterList("?output_modalities=decisions"),
    ]);
    const catalog = buildOpenRouterCatalog(listed, imageListed, decisionListed);
    console.log(
      `Fetched ${catalog.chat.length} tool-capable, ${catalog.images.length} image, and ${catalog.classifiers.length} classifier models from OpenRouter`,
    );
    if (generatorOptions.strict && catalog.images.length === 0) {
      throw new Error("OpenRouter API returned no usable image models");
    }
    return catalog;
  } catch (error) {
    console.error("Failed to fetch OpenRouter models:", error);
    if (generatorOptions.strict) throw error;
    return { chat: [], images: [], classifiers: [] };
  }
}

async function fetchRadiusModels(): Promise<Model<"msa-messages">[]> {
  try {
    console.log("Fetching models from Radius API...");
    const config = await loadRadiusGatewayConfig(DEFAULT_RADIUS_GATEWAY);
    const models = getRadiusModelsFromConfig("radius", config);
    if (models.length === 0) throw new Error("Radius API returned no models");
    console.log(`Fetched ${models.length} models from Radius`);
    return models;
  } catch (error) {
    console.error("Failed to fetch Radius models:", error);
    if (generatorOptions.strict) throw error;
    return [];
  }
}

async function fetchAiGatewayModels(): Promise<{
  chat: Model<any>[];
  classifiers: ClassifierModel<"typesafe-system-one">[];
}> {
  try {
    console.log("Fetching models from Vercel AI Gateway API...");
    const response = await fetch(`${AI_GATEWAY_MODELS_URL}/models`);
    if (!response.ok) throw new Error(`Vercel AI Gateway API returned ${response.status}`);
    const data = (await response.json()) as { data?: unknown };
    const models: Model<any>[] = [];
    const classifiers: ClassifierModel<"typesafe-system-one">[] = [];

    const toNumber = (value: string | number | undefined): number => {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
      }
      const parsed = parseFloat(value ?? "0");
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const items = Array.isArray(data.data) ? (data.data as AiGatewayModel[]) : [];
    for (const model of items) {
      if (model.type === "evaluation") {
        classifiers.push({
          type: "classifier",
          id: model.id,
          name: model.name || model.id,
          api: "typesafe-system-one",
          provider: "vercel-ai-gateway",
          baseUrl: AI_GATEWAY_TYPESAFE_BASE_URL,
          input: ["text"],
          cost: {
            input: roundCost(toNumber(model.pricing?.input) * 1_000_000),
            output: roundCost(toNumber(model.pricing?.output) * 1_000_000),
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: model.context_window || 4096,
        });
        continue;
      }
      const tags = Array.isArray(model.tags) ? model.tags : [];
      if (!tags.includes("tool-use")) continue;

      const input: ("text" | "image")[] = ["text"];
      if (tags.includes("vision")) {
        input.push("image");
      }

      models.push({
        id: model.id,
        name: model.name || model.id,
        api: "anthropic-messages",
        baseUrl: AI_GATEWAY_BASE_URL,
        provider: "vercel-ai-gateway",
        reasoning: tags.includes("reasoning"),
        input,
        compat: { allowEmptySignature: true },
        cost: getAiGatewayCost(model.pricing),
        contextWindow: model.context_window || 4096,
        maxTokens: model.max_tokens || 4096,
      });
    }

    console.log(
      `Fetched ${models.length} tool-capable and ${classifiers.length} classifier models from Vercel AI Gateway`,
    );
    return { chat: models, classifiers };
  } catch (error) {
    console.error("Failed to fetch Vercel AI Gateway models:", error);
    if (generatorOptions.strict) throw error;
    return { chat: [], classifiers: [] };
  }
}

function processZaiModels(data: ModelsDevCatalog): Model<Api>[] {
  const variants = [
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
  const models: Model<Api>[] = [];

  for (const { source, provider, baseUrl } of variants) {
    for (const [modelId, model] of Object.entries(data[source]?.models ?? {})) {
      const m = model as ModelsDevModel;
      if (m.tool_call !== true) continue;
      const supportsImage = m.modalities?.input?.includes("image");

      const thinkingLevelMap = getEffortThinkingLevelMap(m.reasoning_options ?? []);
      const isGlm52 = modelId === "glm-5.2" || modelId === "glm-5.2-highspeed";
      if (thinkingLevelMap !== undefined && isGlm52) {
        thinkingLevelMap.off = "none";
      }
      const supportsReasoningEffort = thinkingLevelMap !== undefined;
      const referenceCost = data["zai"]?.models?.[modelId]?.cost ?? m.cost;

      models.push({
        id: modelId,
        name: m.name || modelId,
        api: "openai-completions",
        provider,
        baseUrl,
        reasoning: m.reasoning === true,
        ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
        input: supportsImage === true ? ["text", "image"] : ["text"],
        cost: getModelsDevCost(referenceCost),
        compat: {
          supportsDeveloperRole: false,
          thinkingFormat: "zai",
          ...(supportsReasoningEffort ? { supportsReasoningEffort: true } : {}),
          ...(ZAI_TOOL_STREAM_UNSUPPORTED_MODELS.has(modelId) ? {} : { zaiToolStream: true }),
        },
        contextWindow: m.limit?.context || 4096,
        maxTokens: m.limit?.output || 4096,
      });
      recordModelsDevReasoningOptions(provider, modelId, m);
    }
  }

  return models;
}

function processBasetenModels(provider: ModelsDevProvider | undefined): Model<Api>[] {
  if (provider?.models === undefined) return [];

  const baseUrl = "https://inference.baseten.co/v1";
  const baseCompat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    supportsStrictMode: true,
    sendSessionAffinityHeaders: true,
    supportsLongCacheRetention: false,
  };
  const reasoningEffortCompat: OpenAICompletionsCompat = {
    ...baseCompat,
    supportsReasoningEffort: true,
    thinkingFormat: "openai",
  };
  const toggleReasoningCompat: OpenAICompletionsCompat = {
    ...baseCompat,
    thinkingFormat: "baseten",
    chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } },
  };
  const toggleReasoningEffortCompat: OpenAICompletionsCompat = {
    ...reasoningEffortCompat,
    thinkingFormat: "baseten",
    chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } },
  };
  const toggleThinkingLevelMap = {
    off: "off",
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  } as const;
  const glm52ThinkingLevelMap = {
    off: "none",
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  } as const;
  const models: Model<Api>[] = [];

  for (const [modelId, model] of Object.entries(provider.models)) {
    if (model.status === "deprecated") continue;

    const reasoning = model.reasoning === true;
    const reasoningOptions = model.reasoning_options ?? [];
    const isGlm52 = modelId === "zai-org/GLM-5.2" || modelId === "zai-org/GLM-5.2-Fast";
    const supportsToggle = reasoningOptions.some((option) => option.type === "toggle") || isGlm52;
    const supportsEffort = reasoningOptions.some((option) => option.type === "effort") || isGlm52;
    const compat =
      supportsToggle && supportsEffort
        ? toggleReasoningEffortCompat
        : supportsToggle
          ? toggleReasoningCompat
          : supportsEffort
            ? reasoningEffortCompat
            : baseCompat;
    const thinkingLevelMap = isGlm52
      ? glm52ThinkingLevelMap
      : supportsToggle
        ? toggleThinkingLevelMap
        : getEffortThinkingLevelMap(reasoningOptions);
    const supportsImageInput = !isGlm52 && model.modalities?.input?.includes("image");

    models.push({
      id: modelId,
      name: model.name || modelId,
      api: "openai-completions",
      provider: "baseten",
      baseUrl,
      reasoning,
      ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
      input: supportsImageInput === true ? ["text", "image"] : ["text"],
      cost: getModelsDevCost(model.cost),
      compat,
      contextWindow: model.limit?.context || 4096,
      maxTokens: model.limit?.output || 4096,
    });
  }

  return models;
}

function processGoogleModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];
  const googleModels = data["google"]?.models;
  if (googleModels !== undefined) {
    for (const [modelId, model] of Object.entries(googleModels)) {
      if (model.tool_call !== true) continue;
      const source =
        modelId === "gemini-flash-latest"
          ? (googleModels["gemini-3.5-flash"] ?? model)
          : modelId === "gemini-flash-lite-latest"
            ? (googleModels["gemini-3.1-flash-lite"] ?? model)
            : model;
      const thinkingLevelMap = getGoogleThinkingLevelMap(modelId, source.reasoning_options ?? []);

      models.push({
        id: modelId,
        name: model.name || modelId,
        api: "google-generative-ai",
        provider: "google",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        reasoning: source.reasoning === true,
        ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
        input: source.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
        cost: getModelsDevCost(source.cost),
        contextWindow: source.limit?.context || 4096,
        maxTokens: source.limit?.output || 4096,
      });
    }
  }

  const vertexModels = data["google-vertex"]?.models;
  if (vertexModels !== undefined) {
    for (const [modelId, model] of Object.entries(vertexModels)) {
      if (model.tool_call !== true || !modelId.startsWith("gemini-")) continue;
      if (modelId === "gemini-3.1-flash-lite-preview") continue;
      const source =
        modelId === "gemini-flash-latest"
          ? (vertexModels["gemini-3.5-flash"] ?? model)
          : modelId === "gemini-flash-lite-latest"
            ? (vertexModels["gemini-3.1-flash-lite"] ?? model)
            : model;
      const thinkingLevelMap = getGoogleThinkingLevelMap(modelId, source.reasoning_options ?? []);
      const cacheRead = modelId === "gemini-2.5-flash" ? 0.03 : source.cost?.cache_read || 0;

      models.push({
        id: modelId,
        name: model.name || modelId,
        api: "google-vertex",
        provider: "google-vertex",
        baseUrl: VERTEX_BASE_URL,
        reasoning: source.reasoning === true,
        ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
        input: source.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
        cost: {
          input: source.cost?.input || 0,
          output: source.cost?.output || 0,
          cacheRead,
          cacheWrite: 0,
        },
        contextWindow: source.limit?.context || 4096,
        maxTokens: source.limit?.output || 4096,
      });
    }
  }

  return models;
}

function processFireworksModels(provider: ModelsDevProvider | undefined): Model<Api>[] {
  if (provider?.models === undefined) return [];

  const anthropicCompat: AnthropicMessagesCompat = {
    allowEmptySignature: true,
    sendSessionAffinityHeaders: true,
    supportsEagerToolInputStreaming: false,
    supportsCacheControlOnTools: false,
    supportsLongCacheRetention: false,
  };
  const openAICompat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    sendSessionAffinityHeaders: true,
    supportsLongCacheRetention: false,
  };
  const kimiK3Compat: OpenAICompletionsCompat = {
    ...openAICompat,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "openai",
  };
  const models: Model<Api>[] = [];

  for (const [modelId, model] of Object.entries(provider.models)) {
    if (model.tool_call !== true) continue;

    const input: ("text" | "image")[] =
      model.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"];
    const common = {
      id: modelId,
      name: model.name || modelId,
      provider: "fireworks",
      reasoning: model.reasoning === true,
      input,
      cost: getModelsDevCost(model.cost),
      contextWindow: model.limit?.context || 4096,
      maxTokens: model.limit?.output || 4096,
    };

    if (modelId.includes("glm-")) {
      models.push({
        ...common,
        api: "openai-completions",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        compat: openAICompat,
      });
    } else if (modelId.includes("kimi-k3")) {
      models.push({
        ...common,
        api: "openai-completions",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        compat: kimiK3Compat,
      });
    } else {
      models.push({
        ...common,
        api: "anthropic-messages",
        baseUrl: "https://api.fireworks.ai/inference",
        compat: {
          ...anthropicCompat,
          ...(model.reasoning_options?.some((option) => option.type === "effort") === true ||
          FIREWORKS_ADAPTIVE_THINKING_FALLBACK_MODELS.has(modelId)
            ? { forceAdaptiveThinking: true }
            : {}),
        },
      });
    }
    recordModelsDevReasoningOptions("fireworks", modelId, model);
  }

  return models;
}

const KIMI_CODING_IMPLIED_COSTS: Record<string, Model<Api>["cost"]> = {
  k3: KIMI_K3_COST,
  "kimi-for-coding": { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
  "kimi-for-coding-highspeed": { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
};
const KIMI_CODING_K3_STYLE_MODEL_IDS = new Set(["k3", "k3-256k", "kimi-for-coding"]);

function createKimiCodingModels(
  kimiModels: Record<string, ModelsDevModel>,
): Model<"openai-completions">[] {
  const models: Model<"openai-completions">[] = [];
  for (const [modelId, m] of Object.entries(kimiModels)) {
    if (m.tool_call !== true) continue;

    const isK3Style = KIMI_CODING_K3_STYLE_MODEL_IDS.has(modelId);
    const impliedCost = KIMI_CODING_IMPLIED_COSTS[modelId];
    const effortLevels =
      isK3Style && m.reasoning_options !== undefined
        ? getEffortThinkingLevelMap(m.reasoning_options)
        : undefined;

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "openai-completions",
      provider: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding/v1",
      compat: {
        ...(isK3Style ? KIMI_K3_OPENAI_COMPAT : KIMI_OPENAI_COMPAT),
        supportsMidConvoSystemMessages: true,
        ...(isK3Style ? { supportsMidConvoToolAdditions: true } : {}),
      },
      reasoning: m.reasoning === true,
      input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
      cost: {
        input: m.cost?.input || impliedCost?.input || 0,
        output: m.cost?.output || impliedCost?.output || 0,
        cacheRead: m.cost?.cache_read || impliedCost?.cacheRead || 0,
        cacheWrite: m.cost?.cache_write || impliedCost?.cacheWrite || 0,
      },
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
      thinkingLevelMap: { ...effortLevels, off: null },
    });
  }
  return models;
}

async function loadModelsDevData(): Promise<Model<any>[]> {
  try {
    console.log("Fetching models from models.dev API...");
    const response = await fetch("https://models.dev/api.json");
    if (!response.ok) throw new Error(`models.dev API returned ${response.status}`);
    const data = (await response.json()) as ModelsDevCatalog;

    const models: Model<any>[] = [];
    const nvidiaNimModelIds =
      data["nvidia"]?.models === undefined
        ? new Map<string, string>()
        : await fetchNvidiaNimModelIds();

    if (data["amazon-bedrock"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["amazon-bedrock"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS.has(modelId)) continue;

        let id = modelId;

        if (id.startsWith("ai21.jamba")) {
          continue;
        }

        if (id.startsWith("mistral.mistral-7b-instruct-v0")) {
          continue;
        }

        models.push({
          id,
          name: m.name || id,
          api: "bedrock-converse-stream" as const,
          provider: "amazon-bedrock" as const,
          baseUrl: getBedrockBaseUrl(id),
          reasoning: m.reasoning === true,
          input: (m.modalities?.input?.includes("image") === true
            ? ["text", "image"]
            : ["text"]) as ("text" | "image")[],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
          ...(m.structured_output === true && { compat: { supportsStrictMode: true } }),
        });
        recordModelsDevReasoningOptions("amazon-bedrock" as const, id, m);
      }
    }

    if (data["anthropic"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["anthropic"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "anthropic-messages",
          provider: "anthropic",
          baseUrl: "https://api.anthropic.com",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("anthropic", modelId, m);
      }
    }

    models.push(...processGoogleModels(data));

    if (data["openai"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["openai"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS.has(modelId)) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-responses",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("openai", modelId, m);
      }
    }

    if (data["groq"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["groq"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("groq", modelId, m);
      }
    }

    if (data["cerebras"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["cerebras"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider: "cerebras",
          baseUrl: "https://api.cerebras.ai/v1",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("cerebras", modelId, m);
      }
    }

    if (data["cloudflare-workers-ai"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["cloudflare-workers-ai"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider: "cloudflare-workers-ai",
          baseUrl: CLOUDFLARE_WORKERS_AI_BASE_URL,
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
          compat: { sendSessionAffinityHeaders: true },
        });
        recordModelsDevReasoningOptions("cloudflare-workers-ai", modelId, m);
      }
    }

    const cloudflareAIGatewayModelIds = new Set<string>();
    if (data["cloudflare-ai-gateway"]?.models !== undefined) {
      for (const [prefixedId, model] of Object.entries(data["cloudflare-ai-gateway"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        const slashIdx = prefixedId.indexOf("/");
        if (slashIdx === -1) continue;
        const upstream = prefixedId.slice(0, slashIdx);
        const nativeId = prefixedId.slice(slashIdx + 1);

        let api: "anthropic-messages" | "openai-completions" | "openai-responses";
        let baseUrl: string;
        let id: string;
        if (upstream === "openai") {
          api = "openai-responses";
          baseUrl = CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL;
          id = nativeId;
        } else if (upstream === "anthropic") {
          api = "anthropic-messages";
          baseUrl = CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL;
          id = nativeId.replaceAll(".", "-");
        } else if (upstream === "workers-ai") {
          api = "openai-completions";
          baseUrl = CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL;
          id = prefixedId;
        } else {
          continue;
        }

        const compat =
          upstream === "anthropic" || upstream === "workers-ai"
            ? { sendSessionAffinityHeaders: true }
            : undefined;

        cloudflareAIGatewayModelIds.add(id);
        models.push({
          id,
          name: m.name || id,
          api,
          provider: "cloudflare-ai-gateway",
          baseUrl,
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
          ...(compat === undefined ? {} : { compat }),
        });
        recordModelsDevReasoningOptions("cloudflare-ai-gateway", id, m);
      }
    }

    if (data["cloudflare-workers-ai"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["cloudflare-workers-ai"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        const id = `workers-ai/${modelId}`;
        if (cloudflareAIGatewayModelIds.has(id)) continue;
        cloudflareAIGatewayModelIds.add(id);

        models.push({
          id,
          name: m.name || id,
          api: "openai-completions",
          provider: "cloudflare-ai-gateway",
          baseUrl: CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
          compat: { sendSessionAffinityHeaders: true },
        });
        recordModelsDevReasoningOptions("cloudflare-ai-gateway", id, m);
      }
    }

    if (data["xai"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["xai"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-responses",
          provider: "xai",
          baseUrl: "https://api.x.ai/v1",
          compat: { ...XAI_RESPONSES_COMPAT },
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("xai", modelId, m);
      }
    }

    if (data["meta"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["meta"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-responses",
          provider: "meta",
          baseUrl: "https://api.meta.ai/v1",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("meta", modelId, m);
      }
    }

    models.push(...processZaiModels(data));

    if (data["mistral"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["mistral"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        const thinkingLevelMap = getEffortThinkingLevelMap(m.reasoning_options ?? []);

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "mistral-conversations",
          provider: "mistral",
          baseUrl: "https://api.mistral.ai",
          reasoning: m.reasoning === true,
          ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: {
            input: m.cost?.input || 0,
            output: m.cost?.output || 0,
            cacheRead:
              m.cost?.cache_read ??
              (m.cost?.input !== undefined && m.cost?.input !== 0 && !Number.isNaN(m.cost?.input)
                ? roundCost(m.cost.input * 0.1)
                : 0),
            cacheWrite: m.cost?.cache_write || 0,
          },
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
      }
    }

    if (data["huggingface"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["huggingface"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider: "huggingface",
          baseUrl: "https://router.huggingface.co/v1",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          compat: {
            supportsDeveloperRole: false,
          },
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("huggingface", modelId, m);
      }
    }

    models.push(...processFireworksModels(data["fireworks-ai"]));

    if (data["nvidia"]?.models !== undefined) {
      for (const [modelId, model] of Object.entries(data["nvidia"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (m.modalities?.input?.includes("text") !== true) continue;
        if (m.modalities?.output?.includes("text") !== true) continue;

        const liveModelId =
          nvidiaNimModelIds.get(modelId) ?? nvidiaNimModelIds.get(normalizeNvidiaModelId(modelId));
        if (liveModelId === undefined || liveModelId === "") continue;
        if (NVIDIA_NIM_UNSUPPORTED_MODELS.has(liveModelId)) continue;

        models.push({
          id: liveModelId,
          name: m.name || liveModelId,
          api: "openai-completions",
          provider: "nvidia",
          baseUrl: NVIDIA_BASE_URL,
          headers: { ...NVIDIA_HEADERS },
          reasoning: m.reasoning === true,
          input: m.modalities.input.includes("image") ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          compat: NVIDIA_OPENAI_COMPAT,
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("nvidia", liveModelId, m);
      }
    }

    const togetherProvider = data["together"] ?? data["togetherai"] ?? data["together-ai"];
    if (togetherProvider?.models !== undefined) {
      for (const [modelId, model] of Object.entries(togetherProvider.models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (m.status === "deprecated") continue;

        const reasoning = m.reasoning === true;
        const thinkingLevelMap = getTogetherThinkingLevelMap(modelId, reasoning);
        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider: "together",
          baseUrl: TOGETHER_BASE_URL,
          reasoning,
          ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          compat: getTogetherCompat(modelId, reasoning),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("together", modelId, m);
      }
    }

    models.push(...processBasetenModels(data["baseten"]));

    const opencodeVariants = [
      { key: "opencode", provider: "opencode", basePath: "https://opencode.ai/inference" },
      { key: "opencode-go", provider: "opencode-go", basePath: "https://opencode.ai/inference/go" },
    ] as const;

    for (const variant of opencodeVariants) {
      const variantData = data[variant.key];
      if (variantData?.models === undefined) continue;

      for (const [modelId, model] of Object.entries(variantData.models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (m.status === "deprecated") continue;

        const npm = m.provider?.npm;
        let api: Api;
        let baseUrl: string;
        let compat: OpenAICompletionsCompat | OpenAIResponsesCompat | undefined;

        if (npm === "@ai-sdk/openai") {
          api = "openai-responses";
          baseUrl = `${variant.basePath}/v1`;
          compat = { sessionAffinityFormat: "openai-nosession" };
        } else if (npm === "@ai-sdk/anthropic") {
          api = "anthropic-messages";
          baseUrl = variant.basePath;
        } else if (npm === "@ai-sdk/google") {
          api = "google-generative-ai";
          baseUrl = `${variant.basePath}/v1`;
        } else if (npm === "@ai-sdk/alibaba") {
          api = "openai-completions";
          baseUrl = `${variant.basePath}/v1`;
          compat = { cacheControlFormat: "anthropic" };
        } else {
          api = "openai-completions";
          baseUrl = `${variant.basePath}/v1`;
        }

        if (variant.provider === "opencode" && modelId === "grok-build-0.1") {
          compat = { ...(compat ?? {}), supportsReasoningEffort: false };
        }

        if (
          (variant.provider === "opencode" || variant.provider === "opencode-go") &&
          modelId === "kimi-k2.6"
        ) {
          compat = {
            ...(compat ?? {}),
            thinkingFormat: "deepseek",
            supportsReasoningEffort: false,
          };
        }

        if (variant.provider === "opencode-go") {
          if (modelId === "qwen3.5-plus" || modelId === "qwen3.6-plus") {
            api = "openai-completions";
            baseUrl = `${variant.basePath}/v1`;
            compat = { ...(compat ?? {}), thinkingFormat: "qwen" };
          }
        }

        if (api === "openai-completions") {
          compat = { ...(compat ?? {}), maxTokensField: "max_tokens" };
          if (
            OPENCODE_OPENAI_COMPLETIONS_LONG_CACHE_RETENTION_UNSUPPORTED_MODELS.has(
              `${variant.provider}:${modelId}`,
            )
          ) {
            compat = { ...compat, supportsLongCacheRetention: false };
          }
        }

        let thinkingLevelMap: NonNullable<Model<Api>["thinkingLevelMap"]> | undefined;
        if (api === "google-generative-ai") {
          thinkingLevelMap = getGoogleThinkingLevelMap(modelId, m.reasoning_options ?? []);
        } else if (variant.provider === "opencode-go" && modelId === "deepseek-v4.1-flash") {
          thinkingLevelMap = getEffortThinkingLevelMap(m.reasoning_options ?? []);
        }
        models.push({
          id: modelId,
          name: m.name || modelId,
          api,
          provider: variant.provider,
          baseUrl,
          reasoning: m.reasoning === true,
          ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          ...(compat === undefined ? {} : { compat }),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions(variant.provider, modelId, m);
      }
    }

    const minimaxVariants = [
      { key: "minimax", provider: "minimax", baseUrl: "https://api.minimax.io/anthropic" },
      { key: "minimax-cn", provider: "minimax-cn", baseUrl: "https://api.minimaxi.com/anthropic" },
    ] as const;

    for (const { key, provider, baseUrl } of minimaxVariants) {
      if (data[key]?.models !== undefined) {
        for (const [modelId, model] of Object.entries(data[key].models)) {
          const m = model as ModelsDevModel;
          if (m.tool_call !== true) continue;

          models.push({
            id: modelId,
            name: m.name || modelId,
            api: "anthropic-messages",
            provider,
            baseUrl,
            reasoning: m.reasoning === true,
            input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
            cost: getModelsDevCost(m.cost),
            contextWindow: m.limit?.context || 4096,
            maxTokens: m.limit?.output || 4096,
          });
          recordModelsDevReasoningOptions(provider, modelId, m);
        }
      }
    }

    if (data["kimi-code-plan-global"]?.models !== undefined) {
      models.push(
        ...createKimiCodingModels(
          data["kimi-code-plan-global"].models as Record<string, ModelsDevModel>,
        ),
      );
    }

    const moonshotVariants = [
      { key: "moonshotai", provider: "moonshotai", baseUrl: "https://api.moonshot.ai/v1" },
      { key: "moonshotai-cn", provider: "moonshotai-cn", baseUrl: "https://api.moonshot.cn/v1" },
    ] as const;
    const getMoonshotProviderModels = (
      key: "moonshotai" | "moonshotai-cn",
    ): Record<string, ModelsDevModel> => {
      const providerModels = data[key]?.models as Record<string, ModelsDevModel> | undefined;
      return providerModels === undefined ? {} : { ...providerModels };
    };
    const moonshotModels = {
      moonshotai: getMoonshotProviderModels("moonshotai"),
      "moonshotai-cn": getMoonshotProviderModels("moonshotai-cn"),
    };

    for (const { key, provider, baseUrl } of moonshotVariants) {
      for (const [modelId, m] of Object.entries(moonshotModels[key])) {
        if (m.tool_call !== true) continue;

        const isKimiK3 = modelId === "kimi-k3";
        const compat = { ...(isKimiK3 ? KIMI_K3_OPENAI_COMPAT : KIMI_OPENAI_COMPAT) };
        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider,
          baseUrl,
          reasoning: isKimiK3 || m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: isKimiK3
            ? { ...KIMI_K3_COST }
            : {
                input: m.cost?.input || 0,
                output: m.cost?.output || 0,
                cacheRead: m.cost?.cache_read || 0,
                cacheWrite: m.cost?.cache_write || 0,
              },
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
          compat,
        });
        recordModelsDevReasoningOptions(provider, modelId, m);
      }
    }

    const xiaomiCompat: OpenAICompletionsCompat = {
      supportsReasoningEffort: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    };
    const xiaomiThinkingLevelMap = {
      off: "off",
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    } as const;
    const xiaomiVariants = [
      { source: "xiaomi", provider: "xiaomi", baseUrl: "https://api.xiaomimimo.com/v1" },
      {
        source: "xiaomi-token-plan-cn",
        provider: "xiaomi-token-plan-cn",
        baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      },
      {
        source: "xiaomi-token-plan-ams",
        provider: "xiaomi-token-plan-ams",
        baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
      },
      {
        source: "xiaomi-token-plan-sgp",
        provider: "xiaomi-token-plan-sgp",
        baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
      },
    ] as const;

    for (const { source, provider, baseUrl } of xiaomiVariants) {
      const providerModels = data[source]?.models;
      if (providerModels === undefined) continue;

      for (const [modelId, model] of Object.entries(providerModels)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (m.status === "deprecated") continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider,
          baseUrl,
          compat: xiaomiCompat,
          reasoning: m.reasoning === true,
          ...(m.reasoning === true ? { thinkingLevelMap: xiaomiThinkingLevelMap } : {}),
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
      }
    }

    const qwenTokenPlanCompat: OpenAICompletionsCompat = {
      thinkingFormat: "qwen",
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: true,
    };
    const qwenTokenPlanVariants = [
      {
        source: "alibaba-token-plan",
        provider: "qwen-token-plan",
        baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        modelIds: undefined,
      },
      {
        source: "alibaba-token-plan",
        provider: "qwen-token-plan-individual",
        baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        modelIds: QWEN_TOKEN_PLAN_INDIVIDUAL_MODEL_IDS,
      },
      {
        source: "alibaba-token-plan-cn",
        provider: "qwen-token-plan-cn",
        baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        modelIds: undefined,
      },
    ] as const;

    for (const { source, provider, baseUrl, modelIds } of qwenTokenPlanVariants) {
      const providerModels = data[source]?.models;
      const emittedModelIds = modelIds === undefined ? undefined : new Set<string>();

      for (const [modelId, model] of Object.entries(providerModels ?? {})) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS.has(modelId)) continue;
        if (modelIds !== undefined && !modelIds.has(modelId)) continue;
        const thinkingLevelMap =
          getEffortThinkingLevelMap(m.reasoning_options ?? []) ??
          (QWEN_TOKEN_PLAN_REASONING_EFFORT_FALLBACK_MODEL_IDS.has(modelId)
            ? QWEN_TOKEN_PLAN_FALLBACK_THINKING_LEVEL_MAP
            : undefined);

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-completions",
          provider,
          baseUrl,
          compat:
            thinkingLevelMap === undefined
              ? { ...qwenTokenPlanCompat, supportsReasoningEffort: false }
              : qwenTokenPlanCompat,
          ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        emittedModelIds?.add(modelId);
      }

      if (modelIds !== undefined && emittedModelIds !== undefined && generatorOptions.strict) {
        assertExactModelIds(provider, modelIds, emittedModelIds);
      }
    }

    console.log(`Loaded ${models.length} tool-capable models from models.dev`);
    return models;
  } catch (error) {
    console.error("Failed to load models.dev data:", error);
    if (generatorOptions.strict) throw error;
    return [];
  }
}

async function loadModelsDevClassifierModels(): Promise<ClassifierModel<"typesafe-system-one">[]> {
  try {
    console.log("Fetching classifier models from models.dev API...");
    const response = await fetch("https://models.dev/models.json?type=decision");
    if (!response.ok) throw new Error(`models.dev classifier API returned ${response.status}`);
    const data = (await response.json()) as Record<string, ModelsDevMetadata>;
    const metadata = data["typesafe/jev-latest"];
    if (metadata === undefined || metadata.type !== "decision") {
      throw new Error("models.dev did not return decision model typesafe/jev-latest");
    }
    return [
      {
        type: "classifier",
        id: "jev-latest",
        name: metadata.name,
        api: "typesafe-system-one",
        provider: "typesafe",
        baseUrl: "https://api.typesafe.ai/v1/",
        input:
          metadata.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: metadata.limit?.context || 64000,
      },
    ];
  } catch (error) {
    console.error("Failed to load models.dev classifier data:", error);
    if (generatorOptions.strict) throw error;
    return [];
  }
}

const OPENCODE_CLASSIFIER_MODELS: ClassifierModel<"typesafe-system-one">[] = [
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

const CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS: ClassifierModel<"cloudflare-workers-ai-system-one">[] =
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

const OPENAI_CLASSIFIER_MODELS: ClassifierModel<"openai-decisions">[] = [
  {
    type: "classifier",
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    api: "openai-decisions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({ input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 }),
    contextWindow: 922000,
  },
];

async function generateModels() {
  const modelsDevModels = await loadModelsDevData();
  const modelsDevClassifierModels = await loadModelsDevClassifierModels();
  const openRouterCatalog = await fetchOpenRouterModels();
  const aiGatewayCatalog = await fetchAiGatewayModels();
  const radiusModels = await fetchRadiusModels();

  const allModels = [
    ...modelsDevModels,
    ...openRouterCatalog.chat,
    ...aiGatewayCatalog.chat,
    ...radiusModels,
  ].filter(
    (model) =>
      !(model.provider === "xai" && XAI_BUILTIN_EXCLUDED_MODEL_IDS.has(model.id)) &&
      !(
        (model.provider === "opencode" || model.provider === "opencode-go") &&
        model.id === "gpt-5.3-codex-spark"
      ),
  );

  for (const candidate of allModels) {
    if (
      candidate.provider === "anthropic" &&
      (candidate.id === "claude-opus-5-5" ||
        candidate.id === "claude-sonnet-5-5" ||
        candidate.id === "claude-haiku-5-5")
    ) {
      mergeThinkingLevelMap(candidate, {
        ...(candidate.id === "claude-haiku-5-5" ? {} : { off: null }),
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      });
    }

    if (
      (candidate.provider === "anthropic" ||
        candidate.provider === "opencode" ||
        candidate.provider === "opencode-go") &&
      (candidate.id === "claude-opus-4-6" ||
        candidate.id === "claude-sonnet-4-6" ||
        candidate.id === "claude-opus-4.6" ||
        candidate.id === "claude-sonnet-4.6")
    ) {
      candidate.contextWindow = 1000000;
    }

    if (
      (candidate.provider === "opencode" || candidate.provider === "opencode-go") &&
      (candidate.id === "claude-sonnet-4-5" || candidate.id === "claude-sonnet-4")
    ) {
      candidate.contextWindow = 200000;
    }
    if (
      (candidate.provider === "opencode" || candidate.provider === "opencode-go") &&
      candidate.id === "gpt-5.4"
    ) {
      candidate.contextWindow = 272000;
      candidate.maxTokens = 128000;
    }
    if (
      candidate.provider === "openai" &&
      OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS.has(candidate.id)
    ) {
      candidate.contextWindow = OPENAI_LONG_CONTEXT_INPUT_THRESHOLD;
      candidate.maxTokens = 128000;
    }
    if (
      candidate.provider === "openai" &&
      OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS.has(candidate.id)
    ) {
      const standardCost = OPENAI_STANDARD_COSTS_BY_ID[candidate.id];
      candidate.cost = withOpenAiLongContextPricing(standardCost ?? candidate.cost);
    }
    if (candidate.provider === "cloudflare-ai-gateway") {
      const standardCost = OPENAI_STANDARD_COSTS_BY_ID[candidate.id];
      if (standardCost !== undefined) candidate.cost = withOpenAiLongContextPricing(standardCost);
    }
    if (candidate.provider === "openai" && candidate.id === "gpt-5-pro") {
      candidate.maxTokens = 128000;
    }
    if (
      (candidate.provider === "openrouter" && OPENROUTER_KIMI_K3_MODEL_IDS.has(candidate.id)) ||
      (candidate.provider === "vercel-ai-gateway" && candidate.id === "moonshotai/kimi-k3")
    ) {
      candidate.maxTokens = KIMI_K3_MAX_TOKENS;
    }
    if (candidate.provider === "openrouter" && candidate.id === "moonshotai/kimi-k2.5") {
      candidate.cost.input = 0.41;
      candidate.cost.output = 2.06;
      candidate.cost.cacheRead = 0.07;
      candidate.maxTokens = 4096;
    }
    if (candidate.provider === "openrouter" && candidate.id.startsWith("moonshotai/kimi-k2.6")) {
      candidate.compat = {
        ...candidate.compat,
        supportsDeveloperRole: false,
        requiresReasoningContentOnAssistantMessages: true,
      };
    }
    if (candidate.provider === "openrouter" && candidate.id === "z-ai/glm-5") {
      candidate.cost.input = 0.6;
      candidate.cost.output = 1.9;
      candidate.cost.cacheRead = 0.119;
    }
  }

  const missingOpenAiModels: Model<"openai-responses">[] = [
    {
      id: "gpt-6.1-sol",
      name: "GPT-6.1 Sol",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6.1-sol"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6-astra"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-6-sol",
      name: "GPT-6 Sol",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6-sol"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-6-luna",
      name: "GPT-6 Luna",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6-luna"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-5.6-sol"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-5.6-terra"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-5.6-luna"]),
      contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
      maxTokens: 128000,
    },
    {
      id: "gpt-5-chat-latest",
      name: "GPT-5 Chat Latest",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      reasoning: false,
      input: ["text", "image"],
      cost: {
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: 0,
      },
      contextWindow: 128000,
      maxTokens: 16384,
    },
  ];
  for (const model of missingOpenAiModels) {
    if (!allModels.some((m) => m.provider === model.provider && m.id === model.id)) {
      allModels.push(model);
    }
  }

  const deepseekCompat = {
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
  } satisfies OpenAICompletionsCompat;
  const deepseekModels: Model<"openai-completions">[] = [
    {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      provider: "deepseek",
      reasoning: true,
      thinkingLevelMap: DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP,
      input: ["text", "image"],
      cost: {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.006,
        cacheWrite: 0,
      },
      contextWindow: 1000000,
      maxTokens: 384000,
      compat: deepseekCompat,
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      provider: "deepseek",
      reasoning: true,
      input: ["text"],
      cost: {
        input: 1.32,
        output: 3.96,
        cacheRead: 0.044,
        cacheWrite: 0,
      },
      contextWindow: 1000000,
      maxTokens: 384000,
      compat: deepseekCompat,
    },
  ];
  allModels.push(...deepseekModels);

  const antLingCompat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
    supportsLongCacheRetention: false,
  };
  const antLingModels: Model<"openai-completions">[] = [
    {
      id: "Ling-2.6-flash",
      name: "Ling 2.6 Flash",
      api: "openai-completions",
      baseUrl: "https://api.ant-ling.com/v1",
      provider: "ant-ling",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 65536,
      compat: antLingCompat,
    },
    {
      id: "Ling-2.6-1T",
      name: "Ling 2.6 1T",
      api: "openai-completions",
      baseUrl: "https://api.ant-ling.com/v1",
      provider: "ant-ling",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 65536,
      compat: antLingCompat,
    },
    {
      id: "Ring-2.6-1T",
      name: "Ring 2.6 1T",
      api: "openai-completions",
      baseUrl: "https://api.ant-ling.com/v1",
      provider: "ant-ling",
      reasoning: true,
      input: ["text"],
      cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 65536,
      compat: { ...antLingCompat, thinkingFormat: "ant-ling" },
    },
  ];
  allModels.push(...antLingModels);

  for (const candidate of allModels) {
    if (
      candidate.api === "openai-completions" &&
      candidate.id.includes("deepseek-v4") &&
      !QWEN_TOKEN_PLAN_PROVIDER_IDS.has(candidate.provider)
    ) {
      const preservesNativeReasoningEffort =
        candidate.provider === "openrouter" || candidate.provider === "opencode";
      candidate.compat = {
        ...candidate.compat,
        ...(preservesNativeReasoningEffort
          ? {
              requiresReasoningContentOnAssistantMessages:
                deepseekCompat.requiresReasoningContentOnAssistantMessages,
            }
          : deepseekCompat),
      };
    }
  }

  const minimaxDirectSupportedIds = new Set([
    "MiniMax-M2.7",
    "MiniMax-M2.7-highspeed",
    "MiniMax-M3",
  ]);

  for (const [i, candidate] of [...allModels.entries()].toReversed()) {
    if (
      (candidate.provider === "minimax" || candidate.provider === "minimax-cn") &&
      !minimaxDirectSupportedIds.has(candidate.id)
    ) {
      allModels.splice(i, 1);
    }
  }

  const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
  const CODEX_CONTEXT = 272000;
  const CODEX_GPT_61_SOL_CONTEXT = 500000;
  const CODEX_GPT_56_CONTEXT = 272000;
  const CODEX_SPARK_CONTEXT = 128000;
  const CODEX_MAX_TOKENS = 128000;
  const codexModels: Model<"openai-codex-responses">[] = [
    {
      id: "gpt-6.1-sol",
      name: "GPT-6.1 Sol",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6.1-sol"]),
      contextWindow: CODEX_GPT_61_SOL_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-6-astra",
      name: "GPT-6 Astra",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6-astra"]),
      contextWindow: CODEX_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-6-sol",
      name: "GPT-6 Sol",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6-sol"]),
      contextWindow: CODEX_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-6-luna",
      name: "GPT-6 Luna",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-6-luna"]),
      contextWindow: CODEX_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text"],
      cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      contextWindow: CODEX_SPARK_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing({ input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }),
      contextWindow: CODEX_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-5.6-luna"]),
      contextWindow: CODEX_GPT_56_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-5.6-sol"]),
      contextWindow: CODEX_GPT_56_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
    {
      id: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: CODEX_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: withOpenAiLongContextPricing(OPENAI_STANDARD_COSTS["gpt-5.6-terra"]),
      contextWindow: CODEX_GPT_56_CONTEXT,
      maxTokens: CODEX_MAX_TOKENS,
    },
  ];
  allModels.push(...codexModels);

  if (!allModels.some((m) => m.provider === "mistral" && m.id === "mistral-medium-3.5")) {
    const thinkingLevelMap = getEffortThinkingLevelMap([
      { type: "effort", values: ["none", "high"] },
    ]);
    allModels.push({
      id: "mistral-medium-3.5",
      name: "Mistral Medium 3.5",
      api: "mistral-conversations",
      provider: "mistral",
      baseUrl: "https://api.mistral.ai",
      reasoning: true,
      ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
      input: ["text", "image"],
      cost: {
        input: 1.5,
        output: 7.5,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 262144,
      maxTokens: 262144,
    });
  }

  if (!allModels.some((m) => m.provider === "openrouter" && m.id === "auto")) {
    allModels.push({
      id: "auto",
      name: "Auto",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 2000000,
      maxTokens: 30000,
    });
  }

  if (!allModels.some((m) => m.provider === "openrouter" && m.id === "openrouter/fusion")) {
    allModels.push({
      id: "openrouter/fusion",
      name: "OpenRouter: Fusion",
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoning: true,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 1000000,
      maxTokens: 30000,
    });
  }

  const AZURE_CONTEXT_WINDOW_OVERRIDES: Record<string, number> = {
    "gpt-5.4": 1050000,
    "gpt-5.5": 1050000,
    "gpt-5.6-luna": 1050000,
    "gpt-5.6-sol": 1050000,
    "gpt-5.6-terra": 1050000,
  };
  const azureOpenAiModels: Model<Api>[] = allModels
    .filter((model) => model.provider === "openai" && model.api === "openai-responses")
    .map((model) =>
      Object.assign({}, model, {
        api: "azure-openai-responses" as const,
        provider: "azure",
        baseUrl: "",
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cacheRead,
          cacheWrite: model.cost.cacheWrite,
        },
        contextWindow: AZURE_CONTEXT_WINDOW_OVERRIDES[model.id] ?? model.contextWindow,
      }),
    );
  allModels.push(...azureOpenAiModels);

  const AZURE_DEEPSEEK_V4_PRO_COST: ModelCost = {
    input: 1.925,
    output: 3.828,
    cacheRead: 0.165,
    cacheWrite: 0,
  };
  const azureDeepSeekModels: Model<Api>[] = allModels
    .filter((model) => model.provider === "deepseek" && model.id === "deepseek-v4-pro")
    .map((model) =>
      Object.assign({}, model, {
        provider: "azure",
        baseUrl: "",
        cost: AZURE_DEEPSEEK_V4_PRO_COST,
        compat: {
          ...(model.compat as OpenAICompletionsCompat),
          supportsDeveloperRole: false,
          supportsMidConvoSystemMessages: true,
          thinkingFormat: "openai" as const,
          supportsLongCacheRetention: false,
        },
      }),
    );
  allModels.push(...azureDeepSeekModels);

  for (const model of allModels) {
    applyOpenAICompletionsCompatMetadata(model);
    applyAnthropicMessagesCompatMetadata(model);
    applyModelsDevReasoningOptionMetadata(model);
    applyThinkingLevelMetadata(model);
    applyStrictToolCompatMetadata(model);
    applyOpenAIGrammarToolCompatMetadata(model);
    applyOpenAIToolSearchMetadata(model);
    applyOpenAICompletionsTranscriptMetadata(model);
    applyOpenAIResponsesTranscriptMetadata(model);
    applyOpenAIExplicitPromptCacheMetadata(model);
    applyOpenAIMidConvoEffortMetadata(model);
    applyPromptCacheMetadata(model);
    applyImageInputMetadata(model);
  }
  applyAnthropicAllowedFallbackModelMetadata(allModels.filter(isAnthropicFallbackMetadataModel));

  type ProviderCatalog = {
    chat: Record<string, Model<Api>>;
    image: Record<string, ImageModel<ImageApi>>;
    classifier: Record<string, ClassifierModel<ClassifierApi>>;
  };
  const providers: Record<string, ProviderCatalog> = {};
  const providerCatalog = (provider: string): ProviderCatalog =>
    (providers[provider] ??= { chat: {}, image: {}, classifier: {} });
  for (const model of allModels) {
    providerCatalog(model.provider).chat[model.id] ??= { ...model, type: "chat" };
  }
  for (const model of openRouterCatalog.images) {
    applyImageInputMetadata(model);
    providerCatalog(model.provider).image[model.id] ??= model;
  }
  const classifierModels: ClassifierModel<ClassifierApi>[] = [
    ...modelsDevClassifierModels,
    ...openRouterCatalog.classifiers,
    ...aiGatewayCatalog.classifiers,
    ...OPENCODE_CLASSIFIER_MODELS,
    ...CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS,
    ...OPENAI_CLASSIFIER_MODELS,
  ];
  for (const model of classifierModels) {
    providerCatalog(model.provider).classifier[model.id] ??= model;
  }

  const sortedProviders = Object.entries(providers).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const sortedProviderIds = sortedProviders.map(([providerId]) => providerId);
  const jsonChatProviders: Record<string, Record<string, Model<Api>>> = {};
  const jsonImageProviders: Record<string, Record<string, ImageModel<ImageApi>>> = {};
  const jsonClassifierProviders: Record<
    string,
    Record<string, ClassifierModel<ClassifierApi>>
  > = {};
  const jsonAllProviders: Record<string, (AnyModel & ModelCatalogEntry)[]> = {};
  for (const [providerId, catalog] of sortedProviders) {
    const chat = Object.fromEntries(
      Object.entries(catalog.chat).sort(([left], [right]) => left.localeCompare(right)),
    );
    const image = Object.fromEntries(
      Object.entries(catalog.image).sort(([left], [right]) => left.localeCompare(right)),
    );
    const classifier = Object.fromEntries(
      Object.entries(catalog.classifier).sort(([left], [right]) => left.localeCompare(right)),
    );
    jsonChatProviders[providerId] = chat;
    jsonImageProviders[providerId] = image;
    jsonClassifierProviders[providerId] = classifier;
    jsonAllProviders[providerId] = [
      ...Object.values(chat),
      ...Object.values(image),
      ...Object.values(classifier),
    ] as (AnyModel & ModelCatalogEntry)[];
  }

  const serializeJson = (value: unknown) =>
    `${JSON.stringify(value, null, generatorOptions.pretty ? 2 : undefined)}\n`;
  const writeJson = (path: string, value: unknown) => writeFileSync(path, serializeJson(value));
  const generatedDataProviderIds = generatorOptions.dataOnly
    ? readModelDataProviderIds(packageRoot)
    : sortedProviderIds;
  const missingProviderIds = generatedDataProviderIds.filter(
    (providerId) => jsonAllProviders[providerId] === undefined,
  );
  if (missingProviderIds.length > 0) {
    throw new Error(`Cannot hydrate missing providers: ${missingProviderIds.join(", ")}`);
  }

  const generatedDataProviders: Record<string, Record<string, Record<string, AnyModel>>> = {};
  const modelDataStructure: ModelDataStructure = {};
  for (const providerId of generatedDataProviderIds) {
    const providerModels = jsonAllProviders[providerId];
    if (providerModels === undefined) {
      throw new Error(`Cannot hydrate missing providers: ${providerId}`);
    }
    const { groups, structure } = groupProviderModelData(providerId, providerModels);
    generatedDataProviders[providerId] = groups;
    modelDataStructure[providerId] = structure;
  }

  const generatedAt = new Date().toISOString();

  if (!generatorOptions.jsonOnly) {
    const providersDir = join(packageRoot, "src/providers");
    const dataDir = join(providersDir, "data");
    const stagingRoot = mkdtempSync(join(providersDir, ".model-generation-"));
    const stagedDataDir = join(stagingRoot, "data");
    const previousDataDir = join(stagingRoot, "previous-data");
    let restoreGeneratedCatalog: (() => void) | undefined;
    try {
      mkdirSync(stagedDataDir, { recursive: true });
      const fileContents: Record<string, string> = {};
      for (const providerId of generatedDataProviderIds) {
        const filename = `${providerId}.json`;
        const content = serializeJson(generatedDataProviders[providerId]);
        fileContents[filename] = content;
        writeFileSync(join(stagedDataDir, filename), content);
      }
      writeJson(
        join(stagedDataDir, MODEL_DATA_MANIFEST_FILE),
        createModelDataManifest(modelDataStructure, fileContents, generatedAt),
      );
      validateModelDataDirectory(modelDataStructure, stagedDataDir);

      if (!generatorOptions.dataOnly) {
        const previousShardContents = new Map(
          readdirSync(providersDir)
            .filter((entry) => entry.endsWith(".models.ts"))
            .map((entry) => [entry, readFileSync(join(providersDir, entry), "utf8")] as const),
        );
        const aggregatorPath = join(packageRoot, "src/models.generated.ts");
        const previousAggregator = readFileSync(aggregatorPath, "utf8");
        restoreGeneratedCatalog = () => {
          for (const entry of readdirSync(providersDir)) {
            if (entry.endsWith(".models.ts")) rmSync(join(providersDir, entry));
          }
          for (const [entry, content] of previousShardContents) {
            writeFileSync(join(providersDir, entry), content);
          }
          writeFileSync(aggregatorPath, previousAggregator);
        };

        const generatedHeader = `// This file is auto-generated by scripts/generate-models.ts
// Do not edit manually - run 'npm run generate-models' to update

`;
        const catalogConstName = (providerId: string) =>
          `${providerId.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_MODELS`;
        const imageCatalogConstName = (providerId: string) =>
          `${providerId.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_IMAGE_MODELS`;
        const classifierCatalogConstName = (providerId: string) =>
          `${providerId.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_CLASSIFIER_MODELS`;
        const generatedShardFiles = new Set<string>();
        for (const providerId of sortedProviderIds) {
          let output = generatedHeader;
          output += `import values from "./data/${providerId}.json" with { type: "json" };\n`;
          output += `import { flattenChatModelCatalog, flattenClassifierModelCatalog, flattenImageModelCatalog, type ChatModelCatalog, type ClassifierModelCatalog, type ImageModelCatalog } from "../model-catalog.ts";\n\n`;
          output += `export const ${catalogConstName(providerId)}: ChatModelCatalog<typeof values, ${JSON.stringify(providerId)}> =\n`;
          output += `\tflattenChatModelCatalog(${JSON.stringify(providerId)}, values);\n\n`;
          output += `export const ${imageCatalogConstName(providerId)}: ImageModelCatalog<typeof values, ${JSON.stringify(providerId)}> =\n`;
          output += `\tflattenImageModelCatalog(${JSON.stringify(providerId)}, values);\n\n`;
          output += `export const ${classifierCatalogConstName(providerId)}: ClassifierModelCatalog<typeof values, ${JSON.stringify(providerId)}> =\n`;
          output += `\tflattenClassifierModelCatalog(${JSON.stringify(providerId)}, values);\n`;
          const filename = `${providerId}.models.ts`;
          generatedShardFiles.add(filename);
          writeFileSync(join(providersDir, filename), output);
        }
        for (const entry of readdirSync(providersDir)) {
          if (entry.endsWith(".models.ts") && !generatedShardFiles.has(entry))
            rmSync(join(providersDir, entry));
        }

        let output = generatedHeader;
        for (const providerId of sortedProviderIds) {
          output += `import { ${classifierCatalogConstName(providerId)}, ${imageCatalogConstName(providerId)}, ${catalogConstName(providerId)} } from "./providers/${providerId}.models.ts";\n`;
        }
        output += `\nexport const MODELS: {\n`;
        for (const providerId of sortedProviderIds) {
          output += `\treadonly ${JSON.stringify(providerId)}: typeof ${catalogConstName(providerId)};\n`;
        }
        output += `} = {\n`;
        for (const providerId of sortedProviderIds) {
          output += `\t${JSON.stringify(providerId)}: ${catalogConstName(providerId)},\n`;
        }
        output += `};\n\nexport const IMAGE_MODELS: {\n`;
        for (const providerId of sortedProviderIds) {
          output += `\treadonly ${JSON.stringify(providerId)}: typeof ${imageCatalogConstName(providerId)};\n`;
        }
        output += `} = {\n`;
        for (const providerId of sortedProviderIds) {
          output += `\t${JSON.stringify(providerId)}: ${imageCatalogConstName(providerId)},\n`;
        }
        output += `};\n\nexport const CLASSIFIER_MODELS: {\n`;
        for (const providerId of sortedProviderIds) {
          output += `\treadonly ${JSON.stringify(providerId)}: typeof ${classifierCatalogConstName(providerId)};\n`;
        }
        output += `} = {\n`;
        for (const providerId of sortedProviderIds) {
          output += `\t${JSON.stringify(providerId)}: ${classifierCatalogConstName(providerId)},\n`;
        }
        output += `};\n`;
        writeFileSync(aggregatorPath, output);
        console.log("Generated provider catalogs and src/models.generated.ts");
      }

      const hadPreviousData = existsSync(dataDir);
      if (hadPreviousData) renameSync(dataDir, previousDataDir);
      try {
        renameSync(stagedDataDir, dataDir);
        validateGeneratedModelData(packageRoot);
      } catch (error) {
        rmSync(dataDir, { recursive: true, force: true });
        if (hadPreviousData && existsSync(previousDataDir)) renameSync(previousDataDir, dataDir);
        throw error;
      }
      restoreGeneratedCatalog = undefined;
      console.log(
        generatorOptions.dataOnly
          ? "Hydrated JSON model values under src/providers/data/"
          : "Generated JSON model values under src/providers/data/",
      );
    } catch (error) {
      restoreGeneratedCatalog?.();
      throw error;
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  if (generatorOptions.jsonOutputDir !== undefined && generatorOptions.jsonOutputDir !== "") {
    const providerOutputDir = join(generatorOptions.jsonOutputDir, "providers");
    rmSync(generatorOptions.jsonOutputDir, { recursive: true, force: true });
    mkdirSync(providerOutputDir, { recursive: true });
    writeJson(join(generatorOptions.jsonOutputDir, "models.json"), jsonChatProviders);
    writeJson(join(generatorOptions.jsonOutputDir, "models.all.json"), jsonAllProviders);
    writeJson(join(generatorOptions.jsonOutputDir, "providers.json"), sortedProviderIds);
    for (const providerId of sortedProviderIds) {
      writeJson(join(providerOutputDir, `${providerId}.json`), jsonChatProviders[providerId]);
      writeJson(join(providerOutputDir, `${providerId}.all.json`), jsonAllProviders[providerId]);
    }
    console.log(`Generated JSON model catalog under ${generatorOptions.jsonOutputDir}`);
  }

  const totalModels = allModels.length;
  const reasoningModels = allModels.filter((model) => model.reasoning).length;

  console.log(`\nModel Statistics:`);
  console.log(`  Total tool-capable models: ${totalModels}`);
  console.log(`  Reasoning-capable models: ${reasoningModels}`);

  for (const [provider, models] of Object.entries(providers)) {
    console.log(
      `  ${provider}: ${Object.keys(models.chat).length} chat models, ${Object.keys(models.image).length} image models, ${Object.keys(models.classifier).length} classifier models`,
    );
  }
}

generateModels().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
