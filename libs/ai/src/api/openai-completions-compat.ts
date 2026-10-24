import type typesModule from "../types.types.ts";
import providerEnv from "../utils/provider-env.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

const { getProviderEnvValue } = providerEnv;

function resolveCacheRetention(input: {
  cacheRetention?: typesModule.CacheRetention | undefined;
  env?: typesModule.ProviderEnv | undefined;
}): typesModule.CacheRetention {
  const { cacheRetention, env } = input;
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}

function detectCompat(
  model: typesModule.Model<"openai-completions">,
): openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat {
  const provider = model.provider;
  const baseUrl = model.baseUrl;

  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");

  const isNonStandard =
    baseUrl.includes("chutes.ai") || provider === "opencode" || baseUrl.includes("opencode.ai");

  const isOllama = provider === "ollama" || baseUrl.includes(":11434");

  const useMaxTokens = baseUrl.includes("chutes.ai") || isOllama;

  const isOpenRouterDeveloperRoleModel =
    isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));
  const cacheControlFormat =
    provider === "openrouter" && model.id.startsWith("anthropic/") ? "anthropic" : undefined;

  return {
    cacheControlFormat,
    chatTemplateKwargs: {},
    maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
    openRouterRouting: isOpenRouter ? { data_collection: "deny" } : {},
    requiresAssistantAfterToolResult: false,
    requiresReasoningContentOnAssistantMessages: false,
    requiresThinkingAsText: false,
    requiresToolResultName: false,
    sendSessionAffinityHeaders: isOpenRouter,
    sessionAffinityFormat: isOpenRouter ? "openrouter" : "openai",
    supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter),
    supportsFinishReason: true,
    supportsLongCacheRetention: true,
    supportsMidConvoSystemMessages: false,
    supportsMidConvoToolAdditions: false,
    supportsOpenAIGrammarTools: false,
    supportsReasoningEffort: true,
    supportsStore: !isNonStandard,
    supportsStrictMode: false,
    supportsThinkingTokenBudget: false,
    supportsUsageInStreaming: true,
    thinkingFormat: isOpenRouter ? "openrouter" : "openai",
    thinkingTokenBudgetField: undefined,
  };
}

function mergeCompat(
  compat: NonNullable<typesModule.Model<"openai-completions">["compat"]>,
  detected: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat,
): openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat {
  return {
    cacheControlFormat: compat.cacheControlFormat ?? detected.cacheControlFormat,
    chatTemplateKwargs: compat.chatTemplateKwargs ?? detected.chatTemplateKwargs,
    maxTokensField: compat.maxTokensField ?? detected.maxTokensField,
    openRouterRouting: { ...detected.openRouterRouting, ...compat.openRouterRouting },
    requiresAssistantAfterToolResult:
      compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
    requiresReasoningContentOnAssistantMessages:
      compat.requiresReasoningContentOnAssistantMessages ??
      detected.requiresReasoningContentOnAssistantMessages,
    requiresThinkingAsText: compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
    requiresToolResultName: compat.requiresToolResultName ?? detected.requiresToolResultName,
    sendSessionAffinityHeaders:
      compat.sendSessionAffinityHeaders ?? detected.sendSessionAffinityHeaders,
    sessionAffinityFormat: compat.sessionAffinityFormat ?? detected.sessionAffinityFormat,
    supportsDeveloperRole: compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
    supportsFinishReason: compat.supportsFinishReason ?? detected.supportsFinishReason,
    supportsLongCacheRetention:
      compat.supportsLongCacheRetention ?? detected.supportsLongCacheRetention,
    supportsMidConvoSystemMessages:
      compat.supportsMidConvoSystemMessages ?? detected.supportsMidConvoSystemMessages,
    supportsMidConvoToolAdditions:
      compat.supportsMidConvoToolAdditions ?? detected.supportsMidConvoToolAdditions,
    supportsOpenAIGrammarTools:
      compat.supportsOpenAIGrammarTools ?? detected.supportsOpenAIGrammarTools,
    supportsReasoningEffort: compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
    supportsStore: compat.supportsStore ?? detected.supportsStore,
    supportsStrictMode: compat.supportsStrictMode ?? detected.supportsStrictMode,
    supportsThinkingTokenBudget:
      compat.supportsThinkingTokenBudget ?? detected.supportsThinkingTokenBudget,
    supportsUsageInStreaming: compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
    thinkingFormat: compat.thinkingFormat ?? detected.thinkingFormat,
    thinkingTokenBudgetField: compat.thinkingTokenBudgetField ?? detected.thinkingTokenBudgetField,
    vllmPriority: compat.vllmPriority,
  };
}

function getCompat(
  model: typesModule.Model<"openai-completions">,
): openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat {
  const detected = detectCompat(model);
  if (model.compat === undefined) return detected;
  return mergeCompat(model.compat, detected);
}

const openaiCompletionsCompat = {
  getCompat,
  resolveCacheRetention,
};

export default openaiCompletionsCompat;
