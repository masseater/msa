import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import transcript from "../utils/transcript.ts";
import openaiPromptCache from "./openai-prompt-cache.ts";
import openaiResponsesConfig from "./openai-responses-config.ts";
import type openaiResponsesConfigTypes from "./openai-responses-config.types.ts";
import openaiResponsesMessages from "./openai-responses-messages.ts";
import type openaiResponsesParamsTypes from "./openai-responses-params.types.ts";
import openaiResponsesReasoning from "./openai-responses-reasoning.ts";
import openaiResponsesTools from "./openai-responses-tools.ts";

const { convertResponsesMessages } = openaiResponsesMessages;
const { isChatGPTSignIn, resolveCacheRetention } = openaiResponsesConfig;
const { clampOpenAIPromptCacheKey } = openaiPromptCache;
const { resolveTranscriptTools } = transcript;
const { convertResponsesTools } = openaiResponsesTools;
const { applyReasoningParams } = openaiResponsesReasoning;

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
const CONFIGURATION_UPDATE_REQUEST_EFFORT = "medium";

type CacheParams = Pick<
  ResponseCreateParamsStreaming,
  "prompt_cache_key" | "prompt_cache_retention" | "prompt_cache_options"
>;

function promptCacheParams(
  compat: openaiResponsesConfigTypes.ResolvedResponsesCompat,
  cacheRetention: typesModule.CacheRetention,
): CacheParams {
  const explicit = compat.supportsExplicitPromptCacheMode;
  const long = cacheRetention === "long" && compat.supportsLongCacheRetention;
  if (!explicit) return long ? { prompt_cache_retention: "24h" } : {};
  if (cacheRetention === "none") return { prompt_cache_options: { mode: "explicit" } };
  return long ? { prompt_cache_options: { ttl: "30m" } } : {};
}

function baseParams({
  model,
  context,
  options,
  compat,
  grammarToolInputProperties,
  configurationUpdateEffort,
}: openaiResponsesParamsTypes.OpenAIResponsesParamsRequest): ResponseCreateParamsStreaming {
  const toolOptions = {
    supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
    supportsStrictMode: compat.supportsStrictMode,
  };
  const input = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
    configurationUpdateEffort,
    grammarToolInputProperties,
    supportsAdditionalTools: compat.supportsAdditionalTools,
    supportsMidConvoSystemMessages: compat.supportsMidConvoSystemMessages,
    supportsToolSearch: compat.supportsToolSearch,
    toolOptions,
  });
  const cacheRetention = resolveCacheRetention(options);
  const promptCacheKey =
    cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId);
  const { requestTools } = resolveTranscriptTools(
    context.messages,
    compat.supportsAdditionalTools || compat.supportsToolSearch,
  );
  return {
    input,
    model: model.id,
    store: false,
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    ...(isChatGPTSignIn(model)(options?.apiKey) ? {} : promptCacheParams(compat, cacheRetention)),
    ...(requestTools.length > 0 ? { tools: convertResponsesTools(requestTools, toolOptions) } : {}),
  };
}

function requestLimits(
  request: openaiResponsesParamsTypes.OpenAIResponsesParamsRequest,
): Partial<ResponseCreateParamsStreaming> {
  const { model, options, compat } = request;
  const fullApi = !isChatGPTSignIn(model)(options?.apiKey);
  const maxTokens = options?.maxTokens;
  const limitTokens =
    maxTokens !== undefined &&
    maxTokens !== 0 &&
    !Number.isNaN(maxTokens) &&
    compat.supportsMaxOutputTokens &&
    fullApi;
  return {
    ...(limitTokens
      ? { max_output_tokens: Math.max(maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS) }
      : {}),
    ...(options?.temperature !== undefined && fullApi ? { temperature: options.temperature } : {}),
    ...(options?.serviceTier === undefined ? {} : { service_tier: options.serviceTier }),
    ...(options?.toolChoice === undefined ? {} : { tool_choice: options.toolChoice }),
  };
}

function buildOpenAIResponsesParams(
  request: openaiResponsesParamsTypes.OpenAIResponsesParamsRequest,
): ResponseCreateParamsStreaming {
  const { model, options, configurationUpdateEffort } = request;
  const params = { ...baseParams(request), ...requestLimits(request) };
  applyReasoningParams(params)({
    effortOverride:
      configurationUpdateEffort === undefined ? undefined : CONFIGURATION_UPDATE_REQUEST_EFFORT,
    model,
    options,
  });
  return params;
}

const openaiResponsesParams = {
  buildOpenAIResponsesParams,
};

export default openaiResponsesParams;
