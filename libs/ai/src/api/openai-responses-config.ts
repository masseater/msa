import type typesModule from "../types.types.ts";
import providerEnv from "../utils/provider-env.ts";
import type openaiResponsesConfigTypes from "./openai-responses-config.types.ts";

const { getProviderEnvValue } = providerEnv;

type ResponsesModel = typesModule.Model<"openai-responses">;

function isChatGPTSignIn(model: ResponsesModel): (apiKey: string | undefined) => boolean {
  return (apiKey) =>
    model.provider === "openai" &&
    model.baseUrl === "https://api.openai.com/v1" &&
    apiKey !== undefined &&
    !apiKey.startsWith("sk-");
}

function hasHeader(headers: typesModule.ProviderHeaders | undefined, name: string): boolean {
  const expected = name.toLowerCase();
  return Object.entries(headers ?? {}).some(
    ([key, value]) => key.toLowerCase() === expected && value !== null && value.trim().length > 0,
  );
}

function getClientApiKey(
  model: Pick<ResponsesModel, "provider">,
): (
  options:
    | Pick<openaiResponsesConfigTypes.OpenAIResponsesOptions, "apiKey" | "headers">
    | undefined,
) => string {
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

function resolveCacheRetention(
  options:
    | Pick<openaiResponsesConfigTypes.OpenAIResponsesOptions, "cacheRetention" | "env">
    | undefined,
): typesModule.CacheRetention {
  if (options?.cacheRetention !== undefined) return options.cacheRetention;
  return getProviderEnvValue("MSA_CACHE_RETENTION", options?.env) === "long" ? "long" : "short";
}

function getCompat(model: ResponsesModel): openaiResponsesConfigTypes.ResolvedResponsesCompat {
  const compat = model.compat;
  return {
    sessionAffinityFormat: compat?.sessionAffinityFormat ?? detectSessionAffinityFormat(model),
    supportsAdditionalTools: compat?.supportsAdditionalTools ?? false,
    supportsDeveloperRole: compat?.supportsDeveloperRole ?? true,
    supportsExplicitPromptCacheMode: compat?.supportsExplicitPromptCacheMode ?? false,
    supportsLongCacheRetention: compat?.supportsLongCacheRetention ?? true,
    supportsMaxOutputTokens: compat?.supportsMaxOutputTokens ?? true,
    supportsMidConvoEffort: compat?.supportsMidConvoEffort ?? false,
    supportsMidConvoSystemMessages: compat?.supportsMidConvoSystemMessages ?? false,
    supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false,
    supportsStrictMode: compat?.supportsStrictMode ?? false,
    supportsToolSearch: compat?.supportsToolSearch ?? false,
  };
}

function getConfigurationUpdateEffort(
  model: ResponsesModel,
): (options: openaiResponsesConfigTypes.OpenAIResponsesOptions | undefined) => string | undefined {
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

const openaiResponsesConfig = {
  getClientApiKey,
  getCompat,
  getConfigurationUpdateEffort,
  isChatGPTSignIn,
  resolveCacheRetention,
};

export default openaiResponsesConfig;
