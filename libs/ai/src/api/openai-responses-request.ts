import OpenAI from "openai";

import type { Model, ProviderHeaders, TranscriptContext } from "../types.ts";
import { getDeclaredTools } from "../utils/transcript.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import {
  getClientApiKey,
  getCompat,
  type OpenAIResponsesOptions,
  type ResolvedResponsesCompat,
  resolveCacheRetention,
} from "./openai-responses-config.ts";
import { buildOpenAIResponsesParams } from "./openai-responses-params.ts";
import { serviceTierPricing } from "./openai-responses-pricing.ts";
import type { ResponsesRequest } from "./openai-responses-run.ts";

type ResponsesModel = Model<"openai-responses">;

function sessionHeaders(
  compat: ResolvedResponsesCompat,
  sessionId: string | undefined,
): ProviderHeaders {
  if (sessionId === undefined || sessionId === "") return {};
  if (compat.sessionAffinityFormat === "openrouter") return { "x-session-id": sessionId };
  return {
    ...(compat.sessionAffinityFormat === "openai" ? { session_id: sessionId } : {}),
    "x-client-request-id": sessionId,
  };
}

function createClient(model: ResponsesModel, options: OpenAIResponsesOptions | undefined): OpenAI {
  const sessionId = resolveCacheRetention(options) === "none" ? undefined : options?.sessionId;
  return new OpenAI({
    apiKey: getClientApiKey(model)(options),
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch: options?.fetch,
    defaultHeaders: {
      "User-Agent": getMsaUserAgent(),
      ...model.headers,
      ...sessionHeaders(getCompat(model), sessionId),
      ...options?.headers,
    },
  });
}

export interface OpenAIResponsesRequestSpec {
  readonly model: ResponsesModel;
  readonly context: TranscriptContext;
  readonly options: OpenAIResponsesOptions | undefined;
  readonly configurationUpdateEffort: string | undefined;
}

export function prepareOpenAIResponsesRequest({
  model,
  context,
  options,
  configurationUpdateEffort,
}: OpenAIResponsesRequestSpec): ResponsesRequest {
  const compat = getCompat(model);
  const client = createClient(model, options);
  const grammarToolInputProperties = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
    compat.supportsOpenAIGrammarTools,
  );
  const params = buildOpenAIResponsesParams({
    model,
    context,
    options,
    compat,
    grammarToolInputProperties,
    configurationUpdateEffort,
  });
  return {
    client,
    params,
    streamOptions: {
      onProviderStreamEvent: options?.onProviderStreamEvent,
      serviceTier: options?.serviceTier,
      grammarToolInputProperties,
      applyServiceTierPricing: serviceTierPricing(model),
    },
  };
}
