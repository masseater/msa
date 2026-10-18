import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";

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
  chatTemplateKwargs: {},
  supportsStrictMode: false,
  supportsOpenAIGrammarTools: false,
  supportsMidConvoSystemMessages: false,
  supportsMidConvoToolAdditions: false,
  sendSessionAffinityHeaders: false,
  supportsLongCacheRetention: true,
};

export function detectOpenAICompletionsCompat(
  model: Model<"openai-completions">,
): OpenAICompletionsResolvedCompat {
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
    supportsStore: !isNonStandard,
    supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter),
    maxTokensField: isChutes ? "max_tokens" : "max_completion_tokens",
    thinkingFormat: isOpenRouter ? "openrouter" : "openai",
    supportsStrictMode: true,
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
