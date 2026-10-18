import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { CacheRetention, Model, TranscriptContext } from "../types.ts";
import { resolveTranscriptTools } from "../utils/transcript.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import {
  isChatGPTSignIn,
  type OpenAIResponsesOptions,
  type ResolvedResponsesCompat,
  resolveCacheRetention,
} from "./openai-responses-config.ts";
import { convertResponsesMessages } from "./openai-responses-messages.ts";
import { applyReasoningParams } from "./openai-responses-reasoning.ts";
import { convertResponsesTools } from "./openai-responses-tools.ts";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
const CONFIGURATION_UPDATE_REQUEST_EFFORT = "medium";

type CacheParams = Pick<
  ResponseCreateParamsStreaming,
  "prompt_cache_key" | "prompt_cache_retention" | "prompt_cache_options"
>;

function promptCacheParams(
  compat: ResolvedResponsesCompat,
  cacheRetention: CacheRetention,
): CacheParams {
  const explicit = compat.supportsExplicitPromptCacheMode;
  const long = cacheRetention === "long" && compat.supportsLongCacheRetention;
  if (!explicit) return long ? { prompt_cache_retention: "24h" } : {};
  if (cacheRetention === "none") return { prompt_cache_options: { mode: "explicit" } };
  return long ? { prompt_cache_options: { ttl: "30m" } } : {};
}

export interface OpenAIResponsesParamsRequest {
  readonly model: Model<"openai-responses">;
  readonly context: TranscriptContext;
  readonly options: OpenAIResponsesOptions | undefined;
  readonly compat: ResolvedResponsesCompat;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  readonly configurationUpdateEffort: string | undefined;
}

function baseParams({
  model,
  context,
  options,
  compat,
  grammarToolInputProperties,
  configurationUpdateEffort,
}: OpenAIResponsesParamsRequest): ResponseCreateParamsStreaming {
  const toolOptions = {
    supportsStrictMode: compat.supportsStrictMode,
    supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
  };
  const input = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: compat.supportsMidConvoSystemMessages,
    supportsAdditionalTools: compat.supportsAdditionalTools,
    supportsToolSearch: compat.supportsToolSearch,
    toolOptions,
    configurationUpdateEffort,
  });
  const cacheRetention = resolveCacheRetention(options);
  const promptCacheKey =
    cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId);
  const { requestTools } = resolveTranscriptTools(
    context.messages,
    compat.supportsAdditionalTools || compat.supportsToolSearch,
  );
  return {
    model: model.id,
    input,
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    ...(isChatGPTSignIn(model)(options?.apiKey) ? {} : promptCacheParams(compat, cacheRetention)),
    store: false,
    ...(requestTools.length > 0 ? { tools: convertResponsesTools(requestTools, toolOptions) } : {}),
  };
}

function requestLimits(
  request: OpenAIResponsesParamsRequest,
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

export function buildOpenAIResponsesParams(
  request: OpenAIResponsesParamsRequest,
): ResponseCreateParamsStreaming {
  const { model, options, configurationUpdateEffort } = request;
  const params = { ...baseParams(request), ...requestLimits(request) };
  applyReasoningParams(params)({
    model,
    options,
    effortOverride:
      configurationUpdateEffort === undefined ? undefined : CONFIGURATION_UPDATE_REQUEST_EFFORT,
  });
  if (model.reasoning && model.provider === "xai") params.include = ["reasoning.encrypted_content"];
  return params;
}
