import OpenAI from "openai";

import type typesModule from "../types.types.ts";
import constrainedSampling from "./constrained-sampling.ts";
import openaiResponsesConfig from "./openai-responses-config.ts";
import type openaiResponsesConfigTypes from "./openai-responses-config.types.ts";
import openaiResponsesParams from "./openai-responses-params.ts";
import openaiResponsesPricing from "./openai-responses-pricing.ts";
import openaiResponsesRequestKit from "./openai-responses-request-kit.ts";
import type openaiResponsesRequestTypes from "./openai-responses-request.types.ts";
import type openaiResponsesRunTypes from "./openai-responses-run.types.ts";

const { transcript, userAgent } = openaiResponsesRequestKit;

const { getClientApiKey, getCompat, resolveCacheRetention } = openaiResponsesConfig;
const { getMsaUserAgent } = userAgent;
const { createGrammarToolInputProperties } = constrainedSampling;
const { getDeclaredTools } = transcript;
const { buildOpenAIResponsesParams } = openaiResponsesParams;
const { serviceTierPricing } = openaiResponsesPricing;

function sessionHeaders(
  compat: openaiResponsesConfigTypes.ResolvedResponsesCompat,
  sessionId: string | undefined,
): typesModule.ProviderHeaders {
  if (sessionId === undefined || sessionId === "") return {};
  if (compat.sessionAffinityFormat === "openrouter") return { "x-session-id": sessionId };
  return {
    ...(compat.sessionAffinityFormat === "openai" ? { session_id: sessionId } : {}),
    "x-client-request-id": sessionId,
  };
}

function createClient(
  model: openaiResponsesRequestTypes.ResponsesModel,
  options: openaiResponsesConfigTypes.OpenAIResponsesOptions | undefined,
): OpenAI {
  const sessionId = resolveCacheRetention(options) === "none" ? undefined : options?.sessionId;
  return new OpenAI({
    apiKey: getClientApiKey(model)(options),
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      "User-Agent": getMsaUserAgent(),
      ...model.headers,
      ...sessionHeaders(getCompat(model), sessionId),
      ...options?.headers,
    },
    fetch: options?.fetch,
  });
}

function prepareOpenAIResponsesRequest({
  model,
  context,
  options,
  configurationUpdateEffort,
}: openaiResponsesRequestTypes.OpenAIResponsesRequestSpec): openaiResponsesRunTypes.ResponsesRequest {
  const compat = getCompat(model);
  const client = createClient(model, options);
  const grammarToolInputProperties = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
    compat.supportsOpenAIGrammarTools,
  );
  const params = buildOpenAIResponsesParams({
    compat,
    configurationUpdateEffort,
    context,
    grammarToolInputProperties,
    model,
    options,
  });
  return {
    client,
    params,
    streamOptions: {
      applyServiceTierPricing: serviceTierPricing(model),
      grammarToolInputProperties,
      onProviderStreamEvent: options?.onProviderStreamEvent,
      serviceTier: options?.serviceTier,
    },
  };
}

const openaiResponsesRequest = {
  prepareOpenAIResponsesRequest,
};

export default openaiResponsesRequest;
