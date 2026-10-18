import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import { TOGETHER_REASONING_ONLY_MODELS } from "./together.ts";

export type OpenAICompletionsResolvedCompat = Required<
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

interface HostTraits {
  readonly isZai: boolean;
  readonly isTogether: boolean;
  readonly isMoonshot: boolean;
  readonly isOpenRouter: boolean;
  readonly isCloudflareWorkersAI: boolean;
  readonly isCloudflareAiGateway: boolean;
  readonly isNvidia: boolean;
  readonly isAntLing: boolean;
  readonly isCerebras: boolean;
  readonly isDeepSeek: boolean;
  readonly isGrok: boolean;
  readonly isChutes: boolean;
  readonly isOpenCode: boolean;
}

function hostTraits({ provider, baseUrl }: Model<"openai-completions">): HostTraits {
  return {
    isZai:
      provider === "zai" ||
      provider === "zai-coding-cn" ||
      baseUrl.includes("api.z.ai") ||
      baseUrl.includes("open.bigmodel.cn"),
    isTogether:
      provider === "together" ||
      baseUrl.includes("api.together.ai") ||
      baseUrl.includes("api.together.xyz"),
    isMoonshot:
      provider === "moonshotai" ||
      provider === "moonshotai-cn" ||
      baseUrl.includes("api.moonshot."),
    isOpenRouter: provider === "openrouter" || baseUrl.includes("openrouter.ai"),
    isCloudflareWorkersAI:
      provider === "cloudflare-workers-ai" || baseUrl.includes("api.cloudflare.com"),
    isCloudflareAiGateway:
      provider === "cloudflare-ai-gateway" || baseUrl.includes("gateway.ai.cloudflare.com"),
    isNvidia: provider === "nvidia" || baseUrl.includes("integrate.api.nvidia.com"),
    isAntLing: provider === "ant-ling" || baseUrl.includes("api.ant-ling.com"),
    isCerebras: provider === "cerebras" || baseUrl.includes("cerebras.ai"),
    isDeepSeek: provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com"),
    isGrok: provider === "xai" || baseUrl.includes("api.x.ai"),
    isChutes: baseUrl.includes("chutes.ai"),
    isOpenCode: provider === "opencode" || baseUrl.includes("opencode.ai"),
  };
}

function isNonStandardHost(traits: HostTraits): boolean {
  return (
    traits.isNvidia ||
    traits.isCerebras ||
    traits.isGrok ||
    traits.isTogether ||
    traits.isChutes ||
    traits.isDeepSeek ||
    traits.isZai ||
    traits.isMoonshot ||
    traits.isOpenCode ||
    traits.isCloudflareWorkersAI ||
    traits.isCloudflareAiGateway ||
    traits.isAntLing
  );
}

function usesMaxTokens(traits: HostTraits): boolean {
  return (
    traits.isChutes ||
    traits.isDeepSeek ||
    traits.isMoonshot ||
    traits.isCloudflareAiGateway ||
    traits.isTogether ||
    traits.isNvidia ||
    traits.isAntLing ||
    traits.isZai
  );
}

function thinkingFormatFor(
  traits: HostTraits,
  model: Model<"openai-completions">,
): OpenAICompletionsResolvedCompat["thinkingFormat"] {
  if (traits.isDeepSeek) return "deepseek";
  if (traits.isZai) return "zai";
  if (traits.isTogether && !TOGETHER_REASONING_ONLY_MODELS.has(model.id)) return "together";
  if (traits.isAntLing) return "ant-ling";
  if (traits.isOpenRouter) return "openrouter";
  return "openai";
}

function hostCapabilities(traits: HostTraits, model: Model<"openai-completions">) {
  const isNonStandard = isNonStandardHost(traits);
  const isOpenRouterDeveloperRoleModel =
    traits.isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));
  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole:
      isOpenRouterDeveloperRoleModel || (!isNonStandard && !traits.isOpenRouter),
    supportsReasoningEffort:
      !traits.isGrok &&
      !traits.isZai &&
      !traits.isMoonshot &&
      !traits.isTogether &&
      !traits.isCloudflareAiGateway &&
      !traits.isNvidia &&
      !traits.isAntLing,
    maxTokensField: usesMaxTokens(traits)
      ? ("max_tokens" as const)
      : ("max_completion_tokens" as const),
    supportsStrictMode:
      !traits.isMoonshot &&
      !traits.isTogether &&
      !traits.isCloudflareAiGateway &&
      !traits.isNvidia &&
      !traits.isCerebras,
    supportsLongCacheRetention: !(
      traits.isTogether ||
      traits.isCloudflareWorkersAI ||
      traits.isCloudflareAiGateway ||
      traits.isNvidia ||
      traits.isAntLing
    ),
  };
}

export function detectOpenAICompletionsCompat(
  model: Model<"openai-completions">,
): OpenAICompletionsResolvedCompat {
  const traits = hostTraits(model);
  const capabilities = hostCapabilities(traits, model);
  const cacheControlFormat =
    model.provider === "openrouter" && /^~?anthropic\//u.test(model.id) ? "anthropic" : undefined;
  return {
    ...OPENAI_COMPLETIONS_DEFAULT_COMPAT,
    supportsStore: capabilities.supportsStore,
    supportsDeveloperRole: capabilities.supportsDeveloperRole,
    supportsReasoningEffort: capabilities.supportsReasoningEffort,
    maxTokensField: capabilities.maxTokensField,
    requiresReasoningContentOnAssistantMessages: traits.isDeepSeek,
    thinkingFormat: thinkingFormatFor(traits, model),
    supportsStrictMode: capabilities.supportsStrictMode,
    ...(cacheControlFormat === undefined ? {} : { cacheControlFormat }),
    sendSessionAffinityHeaders: traits.isOpenRouter,
    supportsLongCacheRetention: capabilities.supportsLongCacheRetention,
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

export function applyOpenAICompletionsCompatMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;
  const detected = openAICompletionsCompatDelta(
    detectOpenAICompletionsCompat(model as Model<"openai-completions">),
  );
  model.compat = { ...detected, ...(model.compat as OpenAICompletionsCompat | undefined) };
  if (Object.keys(model.compat).length === 0) {
    delete model.compat;
  }
}
