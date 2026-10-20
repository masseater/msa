import type {
  Api,
  Model,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "../../src/types.ts";
import getEffortThinkingLevelMap from "../models-dev-reasoning-options.ts";
import modelsDev from "./models-dev.ts";
import type modelsDevTypes from "./models-dev.types.ts";
import thinkingMaps from "./thinking-maps.ts";

const { modelsDevModel, toolModels } = modelsDev;
const { getGoogleThinkingLevelMap } = thinkingMaps;

type OpenCodeCompat = OpenAICompletionsCompat | OpenAIResponsesCompat;

interface OpenCodeVariant {
  readonly key: string;
  readonly provider: "opencode" | "opencode-go";
  readonly basePath: string;
}

interface OpenCodeRoute {
  readonly api: Api;
  readonly baseUrl: string;
  readonly compat: OpenCodeCompat | undefined;
}

const OPENCODE_VARIANTS: readonly OpenCodeVariant[] = [
  { basePath: "https://opencode.ai/inference", key: "opencode", provider: "opencode" },
  { basePath: "https://opencode.ai/inference/go", key: "opencode-go", provider: "opencode-go" },
];

const OPENCODE_OPENAI_COMPLETIONS_LONG_CACHE_RETENTION_UNSUPPORTED_MODELS = new Set([
  "opencode:deepseek-v4-flash",
  "opencode:deepseek-v4-pro",
  "opencode:kimi-k2.5",
  "opencode:kimi-k2.6",
  "opencode:minimax-m2.7",
  "opencode-go:kimi-k2.6",
]);

function npmRoute(npm: string | undefined, basePath: string): OpenCodeRoute {
  switch (npm) {
    case "@ai-sdk/openai":
      return {
        api: "openai-responses",
        baseUrl: `${basePath}/v1`,
        compat: { sessionAffinityFormat: "openai-nosession" },
      };
    case "@ai-sdk/anthropic":
      return { api: "anthropic-messages", baseUrl: basePath, compat: undefined };
    case "@ai-sdk/google":
      return { api: "google-generative-ai", baseUrl: `${basePath}/v1`, compat: undefined };
    case "@ai-sdk/alibaba":
      return {
        api: "openai-completions",
        baseUrl: `${basePath}/v1`,
        compat: { cacheControlFormat: "anthropic" },
      };
    default:
      return { api: "openai-completions", baseUrl: `${basePath}/v1`, compat: undefined };
  }
}

function modelRoute(
  variant: OpenCodeVariant,
  id: string,
  source: modelsDevTypes.ModelsDevModel,
): OpenCodeRoute {
  const route = npmRoute(source.provider?.npm, variant.basePath);
  let { api, baseUrl, compat } = route;
  if (variant.provider === "opencode" && id === "grok-build-0.1")
    compat = { ...compat, supportsReasoningEffort: false };
  if (id === "kimi-k2.6")
    compat = { ...compat, supportsReasoningEffort: false, thinkingFormat: "deepseek" };
  if (variant.provider === "opencode-go" && (id === "qwen3.5-plus" || id === "qwen3.6-plus")) {
    api = "openai-completions";
    baseUrl = `${variant.basePath}/v1`;
    compat = { ...compat, thinkingFormat: "qwen" };
  }
  if (api === "openai-completions") {
    compat = { ...compat, maxTokensField: "max_tokens" };
    if (
      OPENCODE_OPENAI_COMPLETIONS_LONG_CACHE_RETENTION_UNSUPPORTED_MODELS.has(
        `${variant.provider}:${id}`,
      )
    )
      compat = { ...compat, supportsLongCacheRetention: false };
  }
  return { api, baseUrl, compat };
}

function openCodeThinkingLevelMap(
  variant: OpenCodeVariant,
  route: OpenCodeRoute,
  entry: { readonly id: string; readonly source: modelsDevTypes.ModelsDevModel },
): modelsDevTypes.ThinkingLevelMap | undefined {
  if (route.api === "google-generative-ai")
    return getGoogleThinkingLevelMap(entry.id, entry.source.reasoning_options ?? []);
  if (variant.provider === "opencode-go" && entry.id === "deepseek-v4.1-flash")
    return getEffortThinkingLevelMap(entry.source.reasoning_options ?? []);
  return undefined;
}

function openCodeVariantModels(
  { data, remember }: modelsDevTypes.ModelsDevSource,
  variant: OpenCodeVariant,
): Model<Api>[] {
  return toolModels(data[variant.key])
    .filter(([, source]) => source.status !== "deprecated")
    .map(([id, source]) => {
      const route = modelRoute(variant, id, source);
      const thinkingLevelMap = openCodeThinkingLevelMap(variant, route, { id, source });
      remember(variant.provider, id, source);
      return modelsDevModel({
        api: route.api,
        baseUrl: route.baseUrl,
        compat: route.compat,
        id,
        provider: variant.provider,
        source,
        thinkingLevelMap,
      });
    });
}

function openCodeModels(source: modelsDevTypes.ModelsDevSource): Model<Api>[] {
  return OPENCODE_VARIANTS.flatMap((variant) => openCodeVariantModels(source, variant));
}

export default openCodeModels;
