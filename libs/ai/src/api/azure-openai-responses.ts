import { AzureOpenAI } from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { ReasoningEffort } from "openai/resources/shared.js";

import { clampThinkingLevel } from "../models.ts";
import type {
  Api,
  AssistantMessage,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  TranscriptContext,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import {
  getDeclaredTools,
  resolveTranscript,
  resolveTranscriptTools,
} from "../utils/transcript.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import {
  type AzureEndpointOptions,
  resolveAzureConfig,
  resolveDeploymentName,
} from "./azure-openai-config.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from "./openai-responses-shared.ts";
import { buildBaseOptions, resolveSamplingParams } from "./simple-options.ts";

const AZURE_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode", "azure"]);
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;

function formatAzureOpenAIError(error: unknown): string {
  return formatProviderError(normalizeProviderError(error), "Azure OpenAI API error");
}

export interface AzureOpenAIResponsesOptions extends AzureEndpointOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  toolChoice?: ResponseCreateParamsStreaming["tool_choice"] | undefined;
  reasoningSummary?: "auto" | "detailed" | "concise" | null | undefined;
}

export const stream: StreamFunction<"azure-openai-responses", AzureOpenAIResponsesOptions> = (
  model: Model<"azure-openai-responses">,
  context: TranscriptContext,
  options?: AzureOpenAIResponsesOptions,
): AssistantMessageEventStream => {
  const events = new AssistantMessageEventStream();
  const normalizedContext = resolveTranscript(
    context,
    model.compat?.supportsMidConvoSystemMessages,
  );

  (async () => {
    const deploymentName = resolveDeploymentName(model, options);

    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "azure-openai-responses" as Api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    try {
      const apiKey = options?.apiKey;
      if (apiKey === undefined || apiKey === "") {
        throw new Error(`No API key for provider: ${model.provider}`);
      }
      const client = createClient(model, apiKey, options);
      const grammarToolInputProperties = createGrammarToolInputProperties(
        getDeclaredTools(normalizedContext.messages),
        model.compat?.supportsOpenAIGrammarTools ?? false,
      );
      let params = buildParams(
        model,
        normalizedContext,
        options,
        deploymentName,
        grammarToolInputProperties,
      );
      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== undefined) {
        params = nextParams as ResponseCreateParamsStreaming;
      }
      const requestOptions = {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        maxRetries: 0,
      };
      const { data: openaiStream, response } = await retryProviderRequest(
        () => client.responses.create(params, requestOptions).withResponse(),
        {
          maxRetries: options?.maxRetries,
          maxRetryDelayMs: options?.maxRetryDelayMs,
          signal: options?.signal,
        },
      );
      await options?.onResponse?.(
        { status: response.status, headers: headersToRecord(response.headers) },
        model,
      );
      events.push({ type: "start", partial: output });

      await processResponsesStream(openaiStream, output, events, model, {
        onProviderStreamEvent: options?.onProviderStreamEvent,
        grammarToolInputProperties,
      });

      if (options?.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "pending") {
        throw new Error("Azure OpenAI Responses stream ended without a stop reason");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      events.push({ type: "done", reason: output.stopReason, message: output });
      events.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as { index?: number }).index;
        delete (block as { partialJson?: string }).partialJson;
        delete (block as { customInput?: unknown }).customInput;
      }
      output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = formatAzureOpenAIError(error);
      events.push({ type: "error", reason: output.stopReason, error: output });
      events.end();
    }
  })();

  return events;
};

export const streamSimple: StreamFunction<"azure-openai-responses", SimpleStreamOptions> = (
  model: Model<"azure-openai-responses">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const apiKey = options?.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = {
    ...buildBaseOptions(model, context, options, apiKey),
    toolChoice: options?.toolChoice,
  } satisfies AzureOpenAIResponsesOptions;
  const clampedReasoning =
    options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;

  return stream(model, context, {
    ...base,
    reasoningEffort,
  } satisfies AzureOpenAIResponsesOptions);
};

function createClient(
  model: Model<"azure-openai-responses">,
  apiKey: string,
  options?: AzureOpenAIResponsesOptions,
) {
  const headers = { "User-Agent": getMsaUserAgent(), ...model.headers };

  if (options?.headers !== undefined) {
    Object.assign(headers, options.headers);
  }

  const { baseUrl, apiVersion } = resolveAzureConfig(model, options);

  return new AzureOpenAI({
    apiKey,
    apiVersion,
    dangerouslyAllowBrowser: true,
    fetch: options?.fetch,
    defaultHeaders: headers,
    baseURL: baseUrl,
  });
}

function buildParams(
  model: Model<"azure-openai-responses">,
  context: TranscriptContext,
  options: AzureOpenAIResponsesOptions | undefined,
  deploymentName: string,
  grammarToolInputProperties: ReadonlyMap<string, string> = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
    model.compat?.supportsOpenAIGrammarTools ?? false,
  ),
) {
  const supportsAdditionalTools = model.compat?.supportsAdditionalTools ?? false;
  const supportsToolSearch = model.compat?.supportsToolSearch ?? false;
  const transcriptTools = resolveTranscriptTools(
    context.messages,
    supportsAdditionalTools || supportsToolSearch,
  );
  const messages = convertResponsesMessages(model, context, AZURE_TOOL_CALL_PROVIDERS, {
    grammarToolInputProperties,
    supportsMidConvoSystemMessages: model.compat?.supportsMidConvoSystemMessages ?? false,
    supportsAdditionalTools,
    supportsToolSearch,
    toolOptions: {
      supportsStrictMode: model.compat?.supportsStrictMode ?? true,
      supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
    },
  });

  const promptCacheKey = clampOpenAIPromptCacheKey(options?.sessionId);
  const params: ResponseCreateParamsStreaming = {
    model: deploymentName,
    input: messages,
    stream: true,
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    store: false,
  };

  if (
    options?.maxTokens !== undefined &&
    options?.maxTokens !== 0 &&
    !Number.isNaN(options?.maxTokens)
  ) {
    params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
  }

  if (options?.temperature !== undefined) {
    params.temperature = options?.temperature;
  }

  if (transcriptTools.requestTools.length > 0) {
    params.tools = convertResponsesTools(transcriptTools.requestTools, {
      supportsStrictMode: model.compat?.supportsStrictMode ?? true,
      supportsOpenAIGrammarTools: model.compat?.supportsOpenAIGrammarTools ?? false,
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
      const effort =
        options?.reasoningEffort === undefined
          ? reasoningEffort
          : (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort);
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
