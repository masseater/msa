import type OpenAI from "openai";

import type typesModule from "../types.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import type openaiCompletionsCompatTypes from "./openai-completions-compat.types.ts";
import openaiCompletionsMessages from "./openai-completions-messages.ts";
import openaiCompletionsParamsKit from "./openai-completions-params-kit.ts";
import type openaiCompletionsParamsTypes from "./openai-completions-params.types.ts";
import openaiCompletionsThinkingParams from "./openai-completions-thinking-params.ts";
import openaiCompletionsTools from "./openai-completions-tools.ts";
import openaiPromptCache from "./openai-prompt-cache.ts";

const { openaiCompletionsCache, simpleOptions, transcript } = openaiCompletionsParamsKit;

const { clampOpenAIPromptCacheKey } = openaiPromptCache;
const { resolveTranscriptTools } = transcript;
const { convertTools } = openaiCompletionsTools;
const { convertMessages, hasToolHistory } = openaiCompletionsMessages;
const { applyAnthropicCacheControl, getCompatCacheControl } = openaiCompletionsCache;
const { applyThinkingParams, resolveClampedThinkingBudget, resolveThinkingTokenBudgetField } =
  openaiCompletionsThinkingParams;
const { resolveSamplingParams } = simpleOptions;

function resolvePromptCacheKey(
  model: typesModule.Model<"openai-completions">,
  options: openaiCompletionsCompatTypes.OpenAICompletionsOptions | undefined,
  compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
  cacheRetention: typesModule.CacheRetention,
): string | undefined {
  const enabled =
    (model.baseUrl.includes("api.openai.com") && cacheRetention !== "none") ||
    (cacheRetention === "long" && compat.supportsLongCacheRetention);
  return enabled ? clampOpenAIPromptCacheKey(options?.sessionId) : undefined;
}

function applyStreamingOptions(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
): void {
  if (compat.supportsUsageInStreaming) {
    params.stream_options = { include_usage: true };
  }
  if (compat.supportsStore) {
    params.store = false;
  }
}

function applyMaxTokens(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  options: openaiCompletionsCompatTypes.OpenAICompletionsOptions | undefined,
  compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
): void {
  const maxTokens = options?.maxTokens;
  if (maxTokens === undefined || maxTokens === 0 || Number.isNaN(maxTokens)) return;
  if (compat.maxTokensField === "max_tokens") {
    (params as { max_tokens?: number }).max_tokens = maxTokens;
  } else {
    params.max_completion_tokens = maxTokens;
  }
}

function applyTools(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  context: transcriptTypes.TranscriptContext,
  compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat,
): void {
  const transcriptTools = resolveTranscriptTools(
    context.messages,
    compat.supportsMidConvoSystemMessages === true && compat.supportsMidConvoToolAdditions === true,
  );
  if (transcriptTools.requestTools.length > 0) {
    params.tools = convertTools({ compat, tools: transcriptTools.requestTools });
  } else if (hasToolHistory(context.messages)) {
    params.tools = [];
  }
}

interface OptionalParamsInput {
  readonly params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  readonly messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  readonly context: transcriptTypes.TranscriptContext;
  readonly options: openaiCompletionsCompatTypes.OpenAICompletionsOptions | undefined;
  readonly compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat;
  readonly cacheControl: ReturnType<typeof getCompatCacheControl>;
}

function applyOptionalParams(input: OptionalParamsInput): void {
  const { params, messages, context, options, compat, cacheControl } = input;
  applyMaxTokens(params, options, compat);
  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  applyTools(params, context, compat);
  if (cacheControl !== undefined) {
    applyAnthropicCacheControl({ cacheControl, messages, tools: params.tools });
  }
  if (options?.toolChoice !== undefined) {
    params.tool_choice = options.toolChoice;
  }
  if (compat.vllmPriority !== undefined) {
    (params as any).priority = compat.vllmPriority;
  }
}

interface ThinkingParamsInput {
  readonly params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  readonly model: typesModule.Model<"openai-completions">;
  readonly options: openaiCompletionsCompatTypes.OpenAICompletionsOptions | undefined;
  readonly compat: openaiCompletionsCompatTypes.ResolvedOpenAICompletionsCompat;
}

function applyThinking(input: ThinkingParamsInput): void {
  const { params, model, options, compat } = input;
  const thinkingBudget = resolveClampedThinkingBudget({ model, options, params });
  applyThinkingParams({ compat, model, options, params, thinkingBudget });
  const thinkingTokenBudgetField = resolveThinkingTokenBudgetField(compat);
  if (thinkingTokenBudgetField !== undefined && thinkingBudget !== undefined) {
    Object.assign(params, { [thinkingTokenBudgetField]: thinkingBudget });
  }
}
function buildParams(
  input: openaiCompletionsParamsTypes.BuildParamsInput,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
  const { model, context, options, compat, cacheRetention, grammarToolInputProperties } = input;
  const messages = convertMessages(model, context, compat, { grammarToolInputProperties });
  const cacheControl = getCompatCacheControl({ cacheRetention, compat });
  const promptCacheKey = resolvePromptCacheKey(model, options, compat, cacheRetention);
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    messages,
    model: model.id,
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    ...(cacheRetention === "long" && compat.supportsLongCacheRetention
      ? { prompt_cache_retention: "24h" as const }
      : {}),
  };

  applyStreamingOptions(params, compat);
  applyOptionalParams({ cacheControl, compat, context, messages, options, params });
  applyThinking({ compat, model, options, params });

  if (Object.keys(compat.openRouterRouting).length > 0) {
    (params as any).provider = compat.openRouterRouting;
  }

  const samplingParams = resolveSamplingParams(
    model,
    options?.reasoningEffort ?? "off",
    options?.samplingParams,
  );
  if (samplingParams !== undefined) {
    Object.assign(params, samplingParams);
  }

  return params;
}

const openaiCompletionsParams = {
  buildParams,
};

export default openaiCompletionsParams;
