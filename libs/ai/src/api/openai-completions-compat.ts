import type { CacheRetention, Model, ProviderEnv } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import type {
  OpenAICompletionsOptions,
  ResolvedOpenAICompletionsCompat,
} from "./openai-completions-types.ts";

function resolveCacheRetention(input: {
  cacheRetention?: CacheRetention | undefined;
  env?: ProviderEnv | undefined;
}): CacheRetention {
  const { cacheRetention, env } = input;
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}

function detectCompat(model: Model<"openai-completions">): ResolvedOpenAICompletionsCompat {
  const provider = model.provider;
  const baseUrl = model.baseUrl;

  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");

  const isNonStandard =
    baseUrl.includes("chutes.ai") || provider === "opencode" || baseUrl.includes("opencode.ai");

  const useMaxTokens = baseUrl.includes("chutes.ai");

  const isOpenRouterDeveloperRoleModel =
    isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));
  const cacheControlFormat =
    provider === "openrouter" && model.id.startsWith("anthropic/") ? "anthropic" : undefined;

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
    openRouterRouting: isOpenRouter ? { data_collection: "deny" } : {},
    chatTemplateKwargs: {},
    supportsThinkingTokenBudget: false,
    thinkingTokenBudgetField: undefined,
    supportsStrictMode: false,
    supportsOpenAIGrammarTools: false,
    supportsMidConvoSystemMessages: false,
    supportsMidConvoToolAdditions: false,
    cacheControlFormat,
    sendSessionAffinityHeaders: isOpenRouter,
    sessionAffinityFormat: isOpenRouter ? "openrouter" : "openai",
    supportsLongCacheRetention: true,
  };
}

function mergeCompat(
  compat: NonNullable<Model<"openai-completions">["compat"]>,
  detected: ResolvedOpenAICompletionsCompat,
): ResolvedOpenAICompletionsCompat {
  return {
    supportsStore: compat.supportsStore ?? detected.supportsStore,
    supportsDeveloperRole: compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
    supportsReasoningEffort: compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
    supportsUsageInStreaming: compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
    supportsFinishReason: compat.supportsFinishReason ?? detected.supportsFinishReason,
    maxTokensField: compat.maxTokensField ?? detected.maxTokensField,
    requiresToolResultName: compat.requiresToolResultName ?? detected.requiresToolResultName,
    requiresAssistantAfterToolResult:
      compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
    requiresThinkingAsText: compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
    requiresReasoningContentOnAssistantMessages:
      compat.requiresReasoningContentOnAssistantMessages ??
      detected.requiresReasoningContentOnAssistantMessages,
    thinkingFormat: compat.thinkingFormat ?? detected.thinkingFormat,
    openRouterRouting: { ...detected.openRouterRouting, ...compat.openRouterRouting },
    chatTemplateKwargs: compat.chatTemplateKwargs ?? detected.chatTemplateKwargs,
    supportsThinkingTokenBudget:
      compat.supportsThinkingTokenBudget ?? detected.supportsThinkingTokenBudget,
    thinkingTokenBudgetField: compat.thinkingTokenBudgetField ?? detected.thinkingTokenBudgetField,
    supportsStrictMode: compat.supportsStrictMode ?? detected.supportsStrictMode,
    supportsOpenAIGrammarTools:
      compat.supportsOpenAIGrammarTools ?? detected.supportsOpenAIGrammarTools,
    supportsMidConvoSystemMessages:
      compat.supportsMidConvoSystemMessages ?? detected.supportsMidConvoSystemMessages,
    supportsMidConvoToolAdditions:
      compat.supportsMidConvoToolAdditions ?? detected.supportsMidConvoToolAdditions,
    cacheControlFormat: compat.cacheControlFormat ?? detected.cacheControlFormat,
    sendSessionAffinityHeaders:
      compat.sendSessionAffinityHeaders ?? detected.sendSessionAffinityHeaders,
    sessionAffinityFormat: compat.sessionAffinityFormat ?? detected.sessionAffinityFormat,
    supportsLongCacheRetention:
      compat.supportsLongCacheRetention ?? detected.supportsLongCacheRetention,
    vllmPriority: compat.vllmPriority,
  };
}

function getCompat(model: Model<"openai-completions">): ResolvedOpenAICompletionsCompat {
  const detected = detectCompat(model);
  if (model.compat === undefined) return detected;
  return mergeCompat(model.compat, detected);
}

export {
  getCompat,
  resolveCacheRetention,
  type OpenAICompletionsOptions,
  type ResolvedOpenAICompletionsCompat,
};
