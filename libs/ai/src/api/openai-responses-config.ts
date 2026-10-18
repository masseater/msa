import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { CacheRetention, Model, OpenAIResponsesCompat, ProviderHeaders } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import type { ResponsesReasoningOptions } from "./openai-responses-reasoning.ts";

export interface OpenAIResponsesOptions extends ResponsesReasoningOptions {
  serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
}

export type ResolvedResponsesCompat = Required<OpenAIResponsesCompat>;

type ResponsesModel = Model<"openai-responses">;

export function isChatGPTSignIn(model: ResponsesModel): (apiKey: string | undefined) => boolean {
  return (apiKey) =>
    model.provider === "openai" &&
    model.baseUrl === "https://api.openai.com/v1" &&
    apiKey !== undefined &&
    !apiKey.startsWith("sk-");
}

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
  const expected = name.toLowerCase();
  return Object.entries(headers ?? {}).some(
    ([key, value]) => key.toLowerCase() === expected && value !== null && value.trim().length > 0,
  );
}

export function getClientApiKey(
  model: Pick<ResponsesModel, "provider">,
): (options: Pick<OpenAIResponsesOptions, "apiKey" | "headers"> | undefined) => string {
  return (options) => {
    const apiKey = options?.apiKey;
    if (apiKey !== undefined && apiKey !== "") return apiKey;
    const headers = options?.headers;
    if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization")) {
      return "unused";
    }
    throw new Error(`No API key for provider: ${model.provider}`);
  };
}

const detectSessionAffinityFormat = (model: Pick<ResponsesModel, "provider" | "baseUrl">) =>
  model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai")
    ? "openrouter"
    : "openai";

export function resolveCacheRetention(
  options: Pick<OpenAIResponsesOptions, "cacheRetention" | "env"> | undefined,
): CacheRetention {
  if (options?.cacheRetention !== undefined) return options.cacheRetention;
  return getProviderEnvValue("MSA_CACHE_RETENTION", options?.env) === "long" ? "long" : "short";
}

export function getCompat(model: ResponsesModel): ResolvedResponsesCompat {
  const compat = model.compat;
  return {
    supportsDeveloperRole: compat?.supportsDeveloperRole ?? true,
    supportsMidConvoSystemMessages: compat?.supportsMidConvoSystemMessages ?? false,
    sessionAffinityFormat: compat?.sessionAffinityFormat ?? detectSessionAffinityFormat(model),
    supportsLongCacheRetention: compat?.supportsLongCacheRetention ?? true,
    supportsStrictMode: compat?.supportsStrictMode ?? false,
    supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false,
    supportsAdditionalTools: compat?.supportsAdditionalTools ?? false,
    supportsToolSearch: compat?.supportsToolSearch ?? false,
    supportsExplicitPromptCacheMode: compat?.supportsExplicitPromptCacheMode ?? false,
    supportsMaxOutputTokens: compat?.supportsMaxOutputTokens ?? true,
    supportsMidConvoEffort: compat?.supportsMidConvoEffort ?? false,
  };
}

export function getConfigurationUpdateEffort(
  model: ResponsesModel,
): (options: OpenAIResponsesOptions | undefined) => string | undefined {
  return (options) => {
    if (
      !getCompat(model).supportsMidConvoEffort ||
      options?.reasoningEffort === undefined ||
      isChatGPTSignIn(model)(options.apiKey)
    ) {
      return undefined;
    }
    return model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
  };
}
