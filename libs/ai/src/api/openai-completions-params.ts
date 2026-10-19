import type OpenAI from "openai";

import type { CacheRetention, Model } from "../types.ts";
import { resolveTranscriptTools, type TranscriptContext } from "../utils/transcript.ts";
import { applyAnthropicCacheControl, getCompatCacheControl } from "./openai-completions-cache.ts";
import type {
  OpenAICompletionsOptions,
  ResolvedOpenAICompletionsCompat,
} from "./openai-completions-compat.ts";
import { convertMessages, hasToolHistory } from "./openai-completions-messages.ts";
import {
  applyThinkingParams,
  resolveClampedThinkingBudget,
  resolveThinkingTokenBudgetField,
} from "./openai-completions-thinking-params.ts";
import { convertTools } from "./openai-completions-tools.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import { resolveSamplingParams } from "./simple-options.ts";

function resolvePromptCacheKey(
  model: Model<"openai-completions">,
  options: OpenAICompletionsOptions | undefined,
  compat: ResolvedOpenAICompletionsCompat,
  cacheRetention: CacheRetention,
): string | undefined {
  const enabled =
    (model.baseUrl.includes("api.openai.com") && cacheRetention !== "none") ||
    (cacheRetention === "long" && compat.supportsLongCacheRetention);
  return enabled ? clampOpenAIPromptCacheKey(options?.sessionId) : undefined;
}

function applyStreamingOptions(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  compat: ResolvedOpenAICompletionsCompat,
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
  options: OpenAICompletionsOptions | undefined,
  compat: ResolvedOpenAICompletionsCompat,
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
  context: TranscriptContext,
  compat: ResolvedOpenAICompletionsCompat,
): void {
  const transcriptTools = resolveTranscriptTools(
    context.messages,
    compat.supportsMidConvoSystemMessages === true && compat.supportsMidConvoToolAdditions === true,
  );
  if (transcriptTools.requestTools.length > 0) {
    params.tools = convertTools({ tools: transcriptTools.requestTools, compat });
  } else if (hasToolHistory(context.messages)) {
    params.tools = [];
  }
}

interface OptionalParamsInput {
  readonly params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  readonly messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  readonly context: TranscriptContext;
  readonly options: OpenAICompletionsOptions | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
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
    applyAnthropicCacheControl({ messages, tools: params.tools, cacheControl });
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
  readonly model: Model<"openai-completions">;
  readonly options: OpenAICompletionsOptions | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
}

function applyThinking(input: ThinkingParamsInput): void {
  const { params, model, options, compat } = input;
  const thinkingBudget = resolveClampedThinkingBudget({ model, options, params });
  applyThinkingParams({ params, model, options, compat, thinkingBudget });
  const thinkingTokenBudgetField = resolveThinkingTokenBudgetField(compat);
  if (thinkingTokenBudgetField !== undefined && thinkingBudget !== undefined) {
    Object.assign(params, { [thinkingTokenBudgetField]: thinkingBudget });
  }
}

interface BuildParamsInput {
  readonly model: Model<"openai-completions">;
  readonly context: TranscriptContext;
  readonly options: OpenAICompletionsOptions | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
  readonly cacheRetention: CacheRetention;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
}

function buildParams(
  input: BuildParamsInput,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
  const { model, context, options, compat, cacheRetention, grammarToolInputProperties } = input;
  const messages = convertMessages(model, context, compat, { grammarToolInputProperties });
  const cacheControl = getCompatCacheControl({ compat, cacheRetention });
  const promptCacheKey = resolvePromptCacheKey(model, options, compat, cacheRetention);
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: model.id,
    messages,
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    ...(cacheRetention === "long" && compat.supportsLongCacheRetention
      ? { prompt_cache_retention: "24h" as const }
      : {}),
  };

  applyStreamingOptions(params, compat);
  applyOptionalParams({ params, messages, context, options, compat, cacheControl });
  applyThinking({ params, model, options, compat });

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

export { buildParams };
