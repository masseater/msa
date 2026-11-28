import type typesModule from "../../src/types.types.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";

const OPENAI_COMPLETIONS_DEFAULT_COMPAT: openaiCompletionsCompatTypes.OpenAICompletionsResolvedCompat =
  {
    chatTemplateKwargs: {},
    maxTokensField: "max_completion_tokens",
    openRouterRouting: {},
    requiresAssistantAfterToolResult: false,
    requiresReasoningContentOnAssistantMessages: false,
    requiresThinkingAsText: false,
    requiresToolResultName: false,
    sendSessionAffinityHeaders: false,
    supportsDeveloperRole: true,
    supportsFinishReason: true,
    supportsLongCacheRetention: true,
    supportsMidConvoSystemMessages: false,
    supportsMidConvoToolAdditions: false,
    supportsOpenAIGrammarTools: false,
    supportsReasoningEffort: true,
    supportsStore: true,
    supportsStrictMode: false,
    supportsUsageInStreaming: true,
    thinkingFormat: "openai",
  };

function detectOpenAICompletionsCompat(
  model: typesModule.Model<"openai-completions">,
): openaiCompletionsCompatTypes.OpenAICompletionsResolvedCompat {
  const { provider, baseUrl } = model;
  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");
  const isChutes = baseUrl.includes("chutes.ai");
  const isNonStandard = isChutes || provider === "opencode" || baseUrl.includes("opencode.ai");
  const isOpenRouterDeveloperRoleModel =
    isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));
  const cacheControlFormat =
    provider === "openrouter" && /^~?anthropic\//u.test(model.id) ? "anthropic" : undefined;
  return {
    ...OPENAI_COMPLETIONS_DEFAULT_COMPAT,
    maxTokensField: isChutes ? "max_tokens" : "max_completion_tokens",
    supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter),
    supportsStore: !isNonStandard,
    supportsStrictMode: true,
    thinkingFormat: isOpenRouter ? "openrouter" : "openai",
    ...(cacheControlFormat === undefined ? {} : { cacheControlFormat }),
    sendSessionAffinityHeaders: isOpenRouter,
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
  compat: openaiCompletionsCompatTypes.OpenAICompletionsResolvedCompat,
): typesModule.OpenAICompletionsCompat {
  const delta: typesModule.OpenAICompletionsCompat = {};
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

function applyOpenAICompletionsCompatMetadata(model: typesModule.Model<typesModule.Api>): void {
  if (model.api !== "openai-completions") return;
  const detected = openAICompletionsCompatDelta(
    detectOpenAICompletionsCompat(model as typesModule.Model<"openai-completions">),
  );
  model.compat = {
    ...detected,
    ...(model.compat as typesModule.OpenAICompletionsCompat | undefined),
  };
  if (Object.keys(model.compat).length === 0) {
    delete model.compat;
  }
}

const openaiCompletionsCompat = {
  applyOpenAICompletionsCompatMetadata,
  detectOpenAICompletionsCompat,
};

export default openaiCompletionsCompat;
