import { Effect } from "effect";
import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { ReasoningEffort } from "openai/resources/shared.js";

import { clampThinkingLevel } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  CacheRetention,
  Model,
  OpenAIResponsesCompat,
  ProviderEnv,
  ProviderHeaders,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TranscriptContext,
  Usage,
} from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { providerRequestWithRetry } from "../utils/provider-retry.ts";
import {
  getDeclaredTools,
  resolveTranscript,
  resolveTranscriptTools,
} from "../utils/transcript.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from "./openai-responses-shared.ts";
import { buildBaseOptions, resolveSamplingParams } from "./simple-options.ts";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
const CONFIGURATION_UPDATE_REQUEST_EFFORT = "medium";

function isChatGPTSignIn(model: Model<"openai-responses">, apiKey: string | undefined): boolean {
  return (
    model.provider === "openai" &&
    model.baseUrl === "https://api.openai.com/v1" &&
    apiKey !== undefined &&
    !apiKey.startsWith("sk-")
  );
}

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
  if (headers === undefined) return false;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
  }
  return false;
}

function getClientApiKey(
  provider: string,
  apiKey: string | undefined,
  headers: ProviderHeaders | undefined,
): string {
  if (apiKey !== undefined && apiKey !== "") return apiKey;
  if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization"))
    return "unused";
  throw new Error(`No API key for provider: ${provider}`);
}

function detectSessionAffinityFormat(
  model: Pick<Model<"openai-responses">, "provider" | "baseUrl">,
) {
  return model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai")
    ? "openrouter"
    : "openai";
}

function resolveCacheRetention(cacheRetention?: CacheRetention, env?: ProviderEnv): CacheRetention {
  if (cacheRetention !== undefined) {
    return cacheRetention;
  }
  if (getProviderEnvValue("MSA_CACHE_RETENTION", env) === "long") {
    return "long";
  }
  return "short";
}

function getCompat(model: Model<"openai-responses">): Required<OpenAIResponsesCompat> {
  return {
    supportsDeveloperRole: model.compat?.supportsDeveloperRole ?? true,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    sessionAffinityFormat:
      model.compat?.sessionAffinityFormat ?? detectSessionAffinityFormat(model),
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    supportsStrictMode: model.compat?.supportsStrictMode ?? false,
    supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
    supportsAdditionalTools: model.compat?.supportsAdditionalTools ?? false,
    supportsToolSearch: model.compat?.supportsToolSearch ?? false,
    supportsExplicitPromptCacheMode: model.compat?.supportsExplicitPromptCacheMode ?? false,
    supportsMaxOutputTokens: model.compat?.supportsMaxOutputTokens ?? true,
    supportsMidConvoEffort: model.compat?.supportsMidConvoEffort ?? false,
  };
}

function getConfigurationUpdateEffort(
  model: Model<"openai-responses">,
  options: OpenAIResponsesOptions | undefined,
  compat: Required<OpenAIResponsesCompat>,
): string | undefined {
  if (
    !compat.supportsMidConvoEffort ||
    options?.reasoningEffort === undefined ||
    isChatGPTSignIn(model, options.apiKey)
  ) {
    return undefined;
  }
  return model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
}

function getPromptCacheRetention(
  compat: Required<OpenAIResponsesCompat>,
  cacheRetention: CacheRetention,
): "24h" | undefined {
  return cacheRetention === "long" &&
    compat.supportsLongCacheRetention &&
    !compat.supportsExplicitPromptCacheMode
    ? "24h"
    : undefined;
}

function getPromptCacheOptions(
  compat: Required<OpenAIResponsesCompat>,
  cacheRetention: CacheRetention,
): ResponseCreateParamsStreaming["prompt_cache_options"] {
  if (!compat.supportsExplicitPromptCacheMode) return undefined;
  if (cacheRetention === "none") return { mode: "explicit" };
  if (cacheRetention === "long" && compat.supportsLongCacheRetention) return { ttl: "30m" };
  return undefined;
}

export interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  reasoningSummary?: "auto" | "detailed" | "concise" | null | undefined;
  serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
  toolChoice?: ResponseCreateParamsStreaming["tool_choice"] | undefined;
}

export const stream: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
  const events = new AssistantMessageEventStream();
  const normalizedContext = resolveTranscript(
    context,
    getCompat(model).supportsMidConvoSystemMessages,
  );

  Effect.runFork(
    Effect.gen(function* () {
      const compat = getCompat(model);
      const configurationUpdateEffort = getConfigurationUpdateEffort(model, options, compat);
      const output: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api as Api,
        provider: model.provider,
        model: model.id,
        ...(configurationUpdateEffort === undefined
          ? {}
          : { providerThinkingLevel: configurationUpdateEffort }),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "pending",
        timestamp: currentTimeMillis(),
      };
      yield* Effect.gen(function* () {
        const apiKey = getClientApiKey(model.provider, options?.apiKey, options?.headers);
        const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
        const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
        const grammarToolInputProperties = createGrammarToolInputProperties(
          getDeclaredTools(normalizedContext.messages),
          compat.supportsOpenAIGrammarTools,
        );
        const client = createClient(
          model,
          apiKey,
          options?.headers,
          options?.fetch,
          cacheSessionId,
        );
        let params = buildParams(
          model,
          normalizedContext,
          options,
          compat,
          grammarToolInputProperties,
          configurationUpdateEffort,
        );
        const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
        if (nextParams !== undefined) {
          params = nextParams as ResponseCreateParamsStreaming;
        }
        const requestOptions = {
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
          ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
          maxRetries: 0,
        };
        const { data: openaiStream, response } = yield* providerRequestWithRetry(
          () => client.responses.create(params, requestOptions).withResponse(),
          {
            maxRetries: options?.maxRetries,
            maxRetryDelayMs: options?.maxRetryDelayMs,
            signal: options?.signal,
          },
        );
        yield* callHook(() =>
          options?.onResponse?.(
            { status: response.status, headers: headersToRecord(response.headers) },
            model,
          ),
        );
        events.push({ type: "start", partial: output });
        yield* processResponsesStream(openaiStream, output, events, model, {
          onProviderStreamEvent: options?.onProviderStreamEvent,
          serviceTier: options?.serviceTier,
          grammarToolInputProperties,
          applyServiceTierPricing: (usage, serviceTier) =>
            applyServiceTierPricing(usage, serviceTier, model),
        });
        if (options?.signal?.aborted === true) {
          throw new Error("Request was aborted");
        }
        if (output.stopReason === "pending") {
          throw new Error("OpenAI Responses stream ended without a stop reason");
        }
        if (output.stopReason === "aborted" || output.stopReason === "error") {
          throw new Error(output.errorMessage || "An unknown error occurred");
        }
        events.push({ type: "done", reason: output.stopReason, message: output });
        events.end();
      }).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            for (const block of output.content) {
              delete (block as { index?: number }).index;
              delete (block as { partialJson?: string }).partialJson;
              delete (block as { customInput?: unknown }).customInput;
            }
            output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
            const errorMessage = formatProviderError(
              normalizeProviderError(error),
              `${model.provider === "openai" ? "OpenAI" : model.provider} API error`,
            );
            output.errorMessage = errorMessage.includes("subscription_sharing_usage_limit_exceeded")
              ? `${errorMessage}\nCheck your ChatGPT usage: ${CHATGPT_USAGE_URL}`
              : errorMessage;
            events.push({ type: "error", reason: output.stopReason, error: output });
            events.end();
          }),
        ),
      );
    }),
  );

  return events;
};

export const streamSimple: StreamFunction<"openai-responses", SimpleStreamOptions> = (
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  getClientApiKey(model.provider, options?.apiKey, options?.headers);

  const base = {
    ...buildBaseOptions(model, context, options, options?.apiKey),
    toolChoice: options?.toolChoice,
  } satisfies OpenAIResponsesOptions;
  const clampedReasoning =
    options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;

  return stream(model, context, {
    ...base,
    reasoningEffort,
  } satisfies OpenAIResponsesOptions);
};

function createClient(
  model: Model<"openai-responses">,
  apiKey: string,
  optionsHeaders?: ProviderHeaders,
  fetch?: typeof globalThis.fetch,
  sessionId?: string,
) {
  const compat = getCompat(model);
  const headers: ProviderHeaders = { "User-Agent": getMsaUserAgent(), ...model.headers };

  if (sessionId !== undefined && sessionId !== "") {
    if (compat.sessionAffinityFormat === "openrouter") {
      headers["x-session-id"] = sessionId;
    } else {
      if (compat.sessionAffinityFormat === "openai") {
        headers["session_id"] = sessionId;
      }
      headers["x-client-request-id"] = sessionId;
    }
  }

  if (optionsHeaders !== undefined) {
    Object.assign(headers, optionsHeaders);
  }

  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch,
    defaultHeaders: headers,
  });
}

function buildParams(
  model: Model<"openai-responses">,
  context: TranscriptContext,
  options: OpenAIResponsesOptions | undefined,
  compat: Required<OpenAIResponsesCompat>,
  grammarToolInputProperties: ReadonlyMap<string, string>,
  configurationUpdateEffort: string | undefined,
) {
  const transcriptTools = resolveTranscriptTools(
    context.messages,
    compat.supportsAdditionalTools || compat.supportsToolSearch,
  );
  const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: compat.supportsMidConvoSystemMessages,
    supportsAdditionalTools: compat.supportsAdditionalTools,
    supportsToolSearch: compat.supportsToolSearch,
    toolOptions: {
      supportsStrictMode: compat.supportsStrictMode,
      supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
    },
    configurationUpdateEffort,
  });

  const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
  const omitUnsupportedFields = isChatGPTSignIn(model, options?.apiKey);
  const promptCacheKey =
    cacheRetention === "none" ? undefined : clampOpenAIPromptCacheKey(options?.sessionId);
  const promptCacheRetention = omitUnsupportedFields
    ? undefined
    : getPromptCacheRetention(compat, cacheRetention);
  const promptCacheOptions = omitUnsupportedFields
    ? undefined
    : getPromptCacheOptions(compat, cacheRetention);
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    input: messages,
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    ...(promptCacheRetention === undefined ? {} : { prompt_cache_retention: promptCacheRetention }),
    ...(promptCacheOptions === undefined ? {} : { prompt_cache_options: promptCacheOptions }),
    store: false,
  };

  if (
    options?.maxTokens !== undefined &&
    options?.maxTokens !== 0 &&
    !Number.isNaN(options?.maxTokens) &&
    compat.supportsMaxOutputTokens &&
    !omitUnsupportedFields
  ) {
    params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
  }

  if (options?.temperature !== undefined && !omitUnsupportedFields) {
    params.temperature = options?.temperature;
  }

  if (options?.serviceTier !== undefined) {
    params.service_tier = options.serviceTier;
  }

  if (transcriptTools.requestTools.length > 0) {
    params.tools = convertResponsesTools(transcriptTools.requestTools, {
      supportsStrictMode: compat.supportsStrictMode,
      supportsOpenAIGrammarTools: compat.supportsOpenAIGrammarTools,
    });
  }

  if (options?.toolChoice !== undefined) {
    params.tool_choice = options.toolChoice;
  }

  const reasoningEffort =
    options?.reasoningEffort ??
    (options?.reasoningSummary !== undefined && options?.reasoningSummary !== null
      ? "medium"
      : undefined);
  if (model.reasoning) {
    if (reasoningEffort !== undefined) {
      const requestedEffort =
        options?.reasoningEffort === undefined
          ? reasoningEffort
          : (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort);
      const effort =
        configurationUpdateEffort === undefined
          ? requestedEffort
          : CONFIGURATION_UPDATE_REQUEST_EFFORT;
      params.reasoning = {
        effort: effort as ReasoningEffort,
        summary: options?.reasoningSummary || "auto",
      };
      params.include = ["reasoning.encrypted_content"];
    } else if (model.thinkingLevelMap?.off !== null) {
      params.reasoning = {
        effort: (model.thinkingLevelMap?.off ?? "none") as ReasoningEffort,
      };
    }
    if (model.provider === "xai") params.include = ["reasoning.encrypted_content"];
  }

  const samplingParams = resolveSamplingParams(
    model,
    reasoningEffort ?? "off",
    options?.samplingParams,
  );
  if (samplingParams !== undefined) {
    Object.assign(params, samplingParams);
  }

  return params;
}

function getServiceTierCostMultiplier(
  model: Pick<Model<"openai-responses">, "id">,
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
): number {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
    case "fast":
      return model.id === "gpt-5.5" ? 2.5 : 2;
    default:
      return 1;
  }
}

function applyServiceTierPricing(
  usage: Usage,
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  model: Pick<Model<"openai-responses">, "id">,
) {
  const multiplier = getServiceTierCostMultiplier(model, serviceTier);
  if (multiplier === 1) return;

  usage.cost.input *= multiplier;
  usage.cost.output *= multiplier;
  usage.cost.cacheRead *= multiplier;
  usage.cost.cacheWrite *= multiplier;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
