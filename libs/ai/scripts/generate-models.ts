#!/usr/bin/env node

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
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

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
import {
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

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
      if (!value) throw new Error("--json-output requires a directory");
      jsonOutputDir = resolve(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (jsonOnly && !jsonOutputDir) throw new Error("--json-only requires --json-output");
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

type ModelsDevCatalog = Record<string, ModelsDevProvider>;

const VERTEX_BASE_URL = "https://{location}-aiplatform.googleapis.com";
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
// Azure Foundry rejects DeepSeek's own max effort.
const AZURE_DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
} as const;

const KIMI_K3_MAX_TOKENS = 131072;
const OPENROUTER_KIMI_K3_MODEL_IDS = new Set(["moonshotai/kimi-k3", "~moonshotai/kimi-latest"]);

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
// OpenAI documents configuration_update for the GPT-6 family.
// https://developers.openai.com/api/docs/guides/reasoning
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

// Keep the generated default no less restrictive than coding-agent's historical
// image preprocessing. Provider limits can narrow this profile, but unknown
// providers retain the cache-safe 2000px / 4.5 MiB behavior.
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

// Keep current OpenAI prices authoritative until models.dev and passthrough
// catalogs catch up.
// https://developers.openai.com/api/docs/pricing
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
  if (!reasoningOptions || !supportsDirectReasoningEffort(model)) return;
  const thinkingLevelMap = getEffortThinkingLevelMap(reasoningOptions);
  if (thinkingLevelMap) mergeThinkingLevelMap(model, thinkingLevelMap);
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
// OpenRouter rejects `configuration_update` system messages on Opus 5 ("Mid-conversation
// reasoning effort (configuration_update) is not supported on anthropic/claude-opus-5-20260723")
// while accepting them on Fable 5.1, so gate that model there.
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

// Claude models that accept `thinking: {type: "disabled"}` alongside per-message effort.
// Opus 5.5, Sonnet 5.5, Fable 5.1, and Mythos 5.1 reject it.
// https://platform.claude.com/docs/en/build-with-claude/thinking#configuring-thinking
const ANTHROPIC_DISABLED_THINKING_MODELS = new Set([
  "claude-opus-5",
  "claude-haiku-5-5",
  "claude-haiku-5.5",
]);

function supportsAnthropicDisabledThinkingWithMidConvoEffort(modelId: string): boolean {
  // Strip OpenRouter's "anthropic/" or "~anthropic/" prefix and any dated snapshot suffix.
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
  chatTemplateKwargs: {},
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

  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");

  const isNonStandard =
    baseUrl.includes("chutes.ai") || provider === "opencode" || baseUrl.includes("opencode.ai");

  const useMaxTokens = baseUrl.includes("chutes.ai");

  const isOpenRouterDeveloperRoleModel =
    isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));
  const cacheControlFormat =
    provider === "openrouter" && /^~?anthropic\//u.test(model.id) ? "anthropic" : undefined;

  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter),
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsFinishReason: true,
    maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: isOpenRouter ? "openrouter" : "openai",
    openRouterRouting: {},
    chatTemplateKwargs: {},
    // Preserve built-in behavior as explicit metadata against the conservative runtime default.
    supportsStrictMode: true,
    supportsOpenAIGrammarTools: false,
    supportsMidConvoSystemMessages: false,
    supportsMidConvoToolAdditions: false,
    ...(cacheControlFormat ? { cacheControlFormat } : {}),
    sendSessionAffinityHeaders: isOpenRouter,
    supportsLongCacheRetention: true,
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
  if (compat) {
    mergeAnthropicMessagesCompat(model, compat);
    if (
      compat.supportsMidConvoEffort &&
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
    if (!model) continue;

    const compatibleFallbackModelIds = model.compat?.supportsMidConvoEffort
      ? fallbackModelIds.filter(supportsAnthropicMidConvoEffort)
      : fallbackModelIds;
    const allowedFallbackModels = compatibleFallbackModelIds.flatMap((fallbackModelId) => {
      const fallbackModel = modelsById.get(fallbackModelId);
      return fallbackModel
        ? [{ provider: fallbackModel.provider, model: fallbackModel.id, cost: fallbackModel.cost }]
        : [];
    });
    if (allowedFallbackModels.length > 0) {
      mergeAnthropicMessagesCompat(model, { allowedFallbackModels });
    }
  }
}

function applyStrictToolCompatMetadata(model: Model<Api>): void {
  if (model.provider === "openai" && model.api === "openai-responses") {
    model.compat = {
      ...(model.compat as OpenAIResponsesCompat | undefined),
      supportsStrictMode: true,
    };
  } else if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    mergeAnthropicMessagesCompat(model, { supportsStrictTools: true });
  }
}

// Responses endpoints verified (OpenAI, ChatGPT Codex backend, opencode zen) or documented (Azure OpenAI) to pass
// OpenAI custom grammar tools through. OpenAI rejects `type: "custom"` tools
// for pre-GPT-5 models (gpt-4.x, gpt-4o, o-series).
const OPENAI_GRAMMAR_TOOL_PROVIDERS = new Set(["openai", "openai-codex", "azure", "opencode"]);
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
  if (!match || Number(match[1]) < 5) return;
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

// Kimi K3 accepts system text and tool-bearing system messages after the conversation starts;
// OpenCode passes its tool-bearing form through. OpenAI models behind OpenRouter accept plain
// system text in place.
function applyOpenAICompletionsTranscriptMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;
  const isKimiK3 =
    (model.provider === "opencode" || model.provider === "opencode-go") && model.id === "kimi-k3";
  const isTextOnly =
    model.provider === "openrouter" &&
    model.id.startsWith("openai/") &&
    OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id.slice("openai/".length));
  if (!isKimiK3 && !isTextOnly) return;
  model.compat = {
    ...(model.compat as OpenAICompletionsCompat | undefined),
    supportsMidConvoSystemMessages: true,
    ...(isKimiK3 ? { supportsMidConvoToolAdditions: true } : {}),
  };
}

// Newer OpenAI Responses models accept developer messages after the conversation has started.
// OpenCode Zen and OpenCode Go pass both those messages and
// `additional_tools` items through to OpenAI unchanged; tool search is not verified
// through those proxies.
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

// OpenAI charges prompt-cache writes starting with the GPT-5.6 family, and exactly
// those models accept `prompt_cache_options`; older models reject the parameter.
// https://developers.openai.com/api/docs/guides/prompt-caching
function applyOpenAIExplicitPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!(model.cost.cacheWrite > 0)) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsExplicitPromptCacheMode: true,
  };
}

// GPT-6 models accept `configuration_update` input items that change the reasoning effort
// without changing the cached prompt prefix. Not enabled for openai-codex (Codex CLI keeps it
// behind a flag that is off by default) or proxies.
function applyOpenAIMidConvoEffortMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;
  if (!OPENAI_MID_CONVO_EFFORT_MODEL_IDS.has(model.id)) return;
  model.compat = {
    ...(model.compat as OpenAIResponsesCompat | undefined),
    supportsMidConvoEffort: true,
  };
}

// Anthropic ephemeral entries have a hard five-minute lifetime; `ttl: "1h"`
// extends it to one hour. Only direct Anthropic is annotated so cache warming
// does not assume equivalent behavior through proxies.
// https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
const ANTHROPIC_PROMPT_CACHE: ModelPromptCache = { short: 300, long: 3600 };

function applyPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    model.promptCache = ANTHROPIC_PROMPT_CACHE;
  }
  // Do not add OpenAI lifetimes yet. Before enabling warming for explicit
  // OpenAI caches, re-evaluate it using observed expiry, replay, and billing
  // behavior; a documented TTL alone does not establish full cache loss.
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
  if (effortMap) return effortMap;
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
      // GPT-6 Astra and GPT-6.1 Sol reject reasoning.effort "none".
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
  // Anthropic adaptive-thinking effort support (per Anthropic adaptive thinking docs):
  // - "max" is available on all adaptive-thinking Claude models.
  // - "xhigh" is only available on Opus 4.7/4.8/5, Sonnet 5, Haiku 5.5, and Fable 5.
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
          : (model.provider === "opencode" || model.provider === "opencode-go") &&
              model.id.includes("deepseek-v4-flash")
            ? DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP
            : DEEPSEEK_V4_THINKING_LEVEL_MAP,
    );
  }
  if (model.provider === "openai-codex" && supportsOpenAiXhigh(model.id)) {
    mergeThinkingLevelMap(model, { minimal: "low" });
  }
  if (model.provider === "openrouter" && model.id.startsWith("inception/mercury-2")) {
    // Mercury 2 in instant mode (reasoning_effort: "none") disables tool calling.
    // Mark "off" unsupported so the openai-completions provider omits the reasoning param
    // instead of defaulting to {reasoning:{effort:"none"}} (see openai-completions.ts:575).
    // msa's low/medium/high pass through verbatim; OpenRouter normalizes to Mercury's vocabulary.
    mergeThinkingLevelMap(model, { off: null });
  }
  if (model.provider === "openrouter" && model.id === "z-ai/glm-5.2") {
    mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  }
  if (model.provider === "opencode-go" && model.id === "glm-5.2") {
    mergeThinkingLevelMap(model, OPENCODE_GO_GLM52_THINKING_LEVEL_MAP);
  }
  if (model.provider === "opencode-go" && model.id === "kimi-k2.6") {
    // OpenCode Go exposes Kimi K2.6 thinking as on/off, not distinct effort tiers.
    mergeThinkingLevelMap(model, { minimal: null, low: null, medium: null });
  }
  if (model.provider === "opencode" && model.id === "grok-build-0.1") {
    // OpenCode Zen Grok Build reasons by default but rejects explicit reasoningEffort.
    mergeThinkingLevelMap(model, { off: null, minimal: null, low: null, medium: null });
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
  // OpenCode Zen forwards mid-conversation system messages but rejects
  // `tool_addition`/`tool_removal` blocks, so tool changes stay top-level there.
  if (provider === "opencode" && supportsAnthropicMidConvoSystemMessages(modelId)) {
    compat.supportsMidConvoSystemMessages = true;
  }
  // OpenCode Qwen 3.8 Flash emits and accepts thinking blocks with empty signatures.
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
  // Rates a tier does not list keep the base price.
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

  return tiers && tiers.length > 0 ? { ...base, tiers } : base;
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

function processGoogleModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];
  const googleModels = data["google"]?.models;
  if (googleModels) {
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
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        input: source.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
        cost: getModelsDevCost(source.cost),
        contextWindow: source.limit?.context || 4096,
        maxTokens: source.limit?.output || 4096,
      });
    }
  }

  // The google-vertex models.dev catalog also includes Claude, OpenAI, and other
  // MaaS models that do not use the @google/genai Gemini streaming path.
  const vertexModels = data["google-vertex"]?.models;
  if (vertexModels) {
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
      // models.dev reports Vertex cache_read/cache_write values for Gemini 2.5 Flash that
      // do not match the official Gemini API standard pricing table. msa only accounts
      // cachedContentTokenCount as cacheRead.
      const cacheRead = modelId === "gemini-2.5-flash" ? 0.03 : source.cost?.cache_read || 0;

      models.push({
        id: modelId,
        name: model.name || modelId,
        api: "google-vertex",
        provider: "google-vertex",
        baseUrl: VERTEX_BASE_URL,
        reasoning: source.reasoning === true,
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        input: source.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
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

async function loadModelsDevData(): Promise<Model<any>[]> {
  try {
    console.log("Fetching models from models.dev API...");
    const response = await fetch("https://models.dev/api.json");
    if (!response.ok) throw new Error(`models.dev API returned ${response.status}`);
    const data = (await response.json()) as ModelsDevCatalog;

    const models: Model<any>[] = [];

    // Process Amazon Bedrock models
    if (data["amazon-bedrock"]?.models) {
      for (const [modelId, model] of Object.entries(data["amazon-bedrock"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        if (BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS.has(modelId)) continue;

        let id = modelId;

        if (id.startsWith("ai21.jamba")) {
          // These models doesn't support tool use in streaming mode
          continue;
        }

        if (id.startsWith("mistral.mistral-7b-instruct-v0")) {
          // These models doesn't support system messages
          continue;
        }

        models.push({
          id,
          name: m.name || id,
          api: "bedrock-converse-stream" as const,
          provider: "amazon-bedrock" as const,
          baseUrl: getBedrockBaseUrl(id),
          reasoning: m.reasoning === true,
          input: (m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"]) as (
            | "text"
            | "image"
          )[],
          // Includes models.dev pricing tiers, e.g. the long-context tier for OpenAI models (#10326).
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
          ...(m.structured_output === true && { compat: { supportsStrictMode: true } }),
        });
        recordModelsDevReasoningOptions("amazon-bedrock" as const, id, m);
      }
    }

    // Process Anthropic models
    if (data["anthropic"]?.models) {
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
          input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("anthropic", modelId, m);
      }
    }

    models.push(...processGoogleModels(data));

    // Process OpenAI models
    if (data["openai"]?.models) {
      for (const [modelId, model] of Object.entries(data["openai"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;
        // models.dev lists this alias, but it is not accepted by OpenAI APIs.
        if (MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS.has(modelId)) continue;

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "openai-responses",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          reasoning: m.reasoning === true,
          input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions("openai", modelId, m);
      }
    }

    // Process Mistral models
    if (data["mistral"]?.models) {
      for (const [modelId, model] of Object.entries(data["mistral"].models)) {
        const m = model as ModelsDevModel;
        if (m.tool_call !== true) continue;

        // Models with effort values use `reasoning_effort` with these levels.
        // Reasoning models without them (Magistral) use `prompt_mode`.
        const thinkingLevelMap = getEffortThinkingLevelMap(m.reasoning_options ?? []);

        models.push({
          id: modelId,
          name: m.name || modelId,
          api: "mistral-conversations",
          provider: "mistral",
          baseUrl: "https://api.mistral.ai",
          reasoning: m.reasoning === true,
          ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
          input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
          cost: {
            input: m.cost?.input || 0,
            output: m.cost?.output || 0,
            cacheRead: m.cost?.cache_read ?? (m.cost?.input ? roundCost(m.cost.input * 0.1) : 0),
            cacheWrite: m.cost?.cache_write || 0,
          },
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
      }
    }

    // Process OpenCode models (Zen and Go)
    // API mapping based on provider.npm field:
    // - @ai-sdk/openai → openai-responses
    // - @ai-sdk/anthropic → anthropic-messages
    // - @ai-sdk/google → google-generative-ai
    // - null/undefined/@ai-sdk/openai-compatible → openai-completions
    const opencodeVariants = [
      { key: "opencode", provider: "opencode", basePath: "https://opencode.ai/inference" },
      { key: "opencode-go", provider: "opencode-go", basePath: "https://opencode.ai/inference/go" },
    ] as const;

    for (const variant of opencodeVariants) {
      const variantData = data[variant.key];
      if (!variantData?.models) continue;

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
          // Anthropic SDK appends /v1/messages to baseURL
          baseUrl = variant.basePath;
        } else if (npm === "@ai-sdk/google") {
          api = "google-generative-ai";
          baseUrl = `${variant.basePath}/v1`;
        } else if (npm === "@ai-sdk/alibaba") {
          api = "openai-completions";
          baseUrl = `${variant.basePath}/v1`;
          compat = { cacheControlFormat: "anthropic" };
        } else {
          // null, undefined, or @ai-sdk/openai-compatible
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
          // OpenCode Kimi K2.6 accepts Anthropic-style thinking objects
          // and rejects string thinking values or combined reasoning_effort.
          compat = {
            ...(compat ?? {}),
            thinkingFormat: "deepseek",
            supportsReasoningEffort: false,
          };
        }

        // Fix known mismatches between models.dev npm data and actual
        // OpenCode Go endpoint behaviour. models.dev reports these models
        // as @ai-sdk/anthropic, but OpenCode Go serves them through the
        // OpenAI-compatible /v1/chat/completions path.
        if (variant.provider === "opencode-go") {
          if (modelId === "qwen3.5-plus" || modelId === "qwen3.6-plus") {
            api = "openai-completions";
            baseUrl = `${variant.basePath}/v1`;
            // Qwen/DashScope uses enable_thinking at the top level.
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
          ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
          input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
          cost: getModelsDevCost(m.cost),
          ...(compat ? { compat } : {}),
          contextWindow: m.limit?.context || 4096,
          maxTokens: m.limit?.output || 4096,
        });
        recordModelsDevReasoningOptions(variant.provider, modelId, m);
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

// OpenCode Zen serves Jev through its TypeSafe-compatible System One endpoint.
// Neither its /inference/v1/models listing nor models.dev carries metadata for it.
// https://opencode.ai/docs/zen
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

// OpenAI Decisions API (public beta): gpt-6-luna is its only model. It bills input tokens only,
// with the same long-context multiplier as chat requests. Only API keys work: Sign in with ChatGPT
// tokens are rejected on /v1/decisions, and the Codex backend has no Decisions route.
// The endpoint rejects inputs above 922K tokens (the model's documented maximum input), but
// requests running longer than about five seconds, currently above roughly 600K input tokens,
// fail with a gateway timeout.
// https://developers.openai.com/api/docs/guides/decisions
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
  // Fetch models from all upstream catalogs.
  // models.dev: Anthropic, Google, OpenAI, and others
  // OpenRouter: its tool-capable routed catalog
  // Radius: its unauthenticated public catalog; authenticated clients overlay it at runtime
  const modelsDevModels = await loadModelsDevData();
  const openRouterCatalog = await fetchOpenRouterModels();
  const radiusModels = await fetchRadiusModels();

  // Combine chat models (models.dev has priority where sources overlap).
  const allModels = [...modelsDevModels, ...openRouterCatalog.chat, ...radiusModels].filter(
    (model) =>
      !(
        (model.provider === "opencode" || model.provider === "opencode-go") &&
        model.id === "gpt-5.3-codex-spark"
      ),
  );

  // Temporary overrides until upstream model metadata is corrected.
  for (const candidate of allModels) {
    // models.dev may list Opus 5.5, Sonnet 5.5, and Haiku 5.5 before their effort metadata is complete.
    if (
      candidate.provider === "anthropic" &&
      (candidate.id === "claude-opus-5-5" ||
        candidate.id === "claude-sonnet-5-5" ||
        candidate.id === "claude-haiku-5-5")
    ) {
      mergeThinkingLevelMap(candidate, {
        // Haiku 5.5 accepts disabled thinking; Opus 5.5 and Sonnet 5.5 reject it.
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

    // OpenCode variants list Claude Sonnet 4/4.5 with 1M context, actual limit is 200K
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
    // Keep direct OpenAI requests in the short-context pricing tier by default. Users can opt into the
    // larger context through model overrides, so retain long-context cost metadata on the capped models.
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
    // models.dev reports gpt-5-pro output as 272000 (a duplicate of the input sub-limit);
    // the actual max output is 128000. Also propagates to the derived Azure clone.
    if (candidate.provider === "openai" && candidate.id === "gpt-5-pro") {
      candidate.maxTokens = 128000;
    }
    // Keep Kimi K3's canonical output limit when gateway metadata is missing or incorrect.
    if (candidate.provider === "openrouter" && OPENROUTER_KIMI_K3_MODEL_IDS.has(candidate.id)) {
      candidate.maxTokens = KIMI_K3_MAX_TOKENS;
    }
    // Keep selected OpenRouter model metadata stable until upstream settles.
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

  // Add missing gpt models
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
  for (const candidate of allModels) {
    if (candidate.api === "openai-completions" && candidate.id.includes("deepseek-v4")) {
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

  // OpenAI Codex (ChatGPT OAuth) models
  // NOTE: These are not fetched from models.dev; we keep a small, explicit list to avoid aliases.
  // Older model limits are based on observed server behavior; GPT-5.6 and GPT-6 use Codex's 272k default catalog limit.
  // GPT-6.1 Sol uses the 500k default returned by /backend-api/codex/models.
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

  // Add missing Mistral Medium 3.5 model until models.dev includes it
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
      // 256k tokens
      contextWindow: 262144,
      maxTokens: 262144,
    });
  }

  // Add "auto" alias for openrouter/auto
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
        // we dont know about the costs because OpenRouter auto routes to different models
        // and then charges you for the underlying used model
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 2000000,
      maxTokens: 30000,
    });
  }

  // Add "fusion" alias for openrouter/fusion. OpenRouter exposes Fusion as a
  // router alias/plugin entry point; its model metadata does not advertise
  // tools, but the alias resolves to a concrete model that can invoke caller
  // tools and has the openrouter:fusion server tool auto-injected.
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
        // we dont know about the costs because Fusion routes to multiple models
        // and then charges you for the underlying used models
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 1000000,
      maxTokens: 30000,
    });
  }

  // Azure Foundry deploys these with larger context windows than OpenAI's own short-tier defaults.
  // See models-sold-directly-by-azure docs.
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

  // Azure resells DeepSeek at its own rates. US data zone, checked 2026-09-16.
  // https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/
  const AZURE_DEEPSEEK_V4_PRO_COST: ModelCost = {
    input: 1.925,
    output: 3.828,
    cacheRead: 0.165,
    cacheWrite: 0,
  };
  // Azure 400s on DeepSeek's `thinking` field and on every prompt cache parameter, discards a
  // `developer` system message unbilled once reasoning_effort is set, and honours mid-convo ones (#9645).
  allModels.push({
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-completions",
    baseUrl: "",
    provider: "azure",
    reasoning: true,
    input: ["text"],
    cost: AZURE_DEEPSEEK_V4_PRO_COST,
    contextWindow: 1000000,
    maxTokens: 384000,
    compat: {
      ...deepseekCompat,
      supportsDeveloperRole: false,
      supportsMidConvoSystemMessages: true,
      thinkingFormat: "openai",
      supportsLongCacheRetention: false,
    },
  });

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

  // Keep chat and image catalogs separate so one upstream ID can expose both
  // operations with different API implementations.
  type ProviderCatalog = {
    chat: Record<string, Model<Api>>;
    image: Record<string, ImageModel<ImageApi>>;
    classifier: Record<string, ClassifierModel<ClassifierApi>>;
  };
  const providers: Record<string, ProviderCatalog> = {};
  const providerCatalog = (provider: string): ProviderCatalog =>
    (providers[provider] ??= { chat: {}, image: {}, classifier: {} });
  for (const model of allModels) {
    // Only add if not already present (models.dev takes priority over OpenRouter).
    providerCatalog(model.provider).chat[model.id] ??= { ...model, type: "chat" };
  }
  for (const model of openRouterCatalog.images) {
    applyImageInputMetadata(model);
    providerCatalog(model.provider).image[model.id] ??= model;
  }
  const classifierModels: ClassifierModel<ClassifierApi>[] = [
    ...openRouterCatalog.classifiers,
    ...OPENCODE_CLASSIFIER_MODELS,
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
    (providerId) => !jsonAllProviders[providerId],
  );
  if (missingProviderIds.length > 0) {
    throw new Error(`Cannot hydrate missing providers: ${missingProviderIds.join(", ")}`);
  }

  // Only the ignored internal data is grouped by API for type derivation.
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
    // Stage and validate all provider values before replacing the current generated data.
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

  if (generatorOptions.jsonOutputDir) {
    // `models.json` and `providers/{id}.json` retain the legacy keyed chat catalog.
    // The `.all` variants are arrays so the same upstream id can appear once per type.
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

  // Print statistics
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

// Run the generator
generateModels().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
