import { CLOUDFLARE_WORKERS_AI_BASE_URL } from "../../src/api/cloudflare.ts";
import type { Api, Model } from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import {
  type ModelsDevModel,
  modelsDevModel,
  type ModelsDevSource,
  roundCost,
  toolModels,
} from "./models-dev.ts";

interface DirectProvider {
  readonly source: string;
  readonly provider: string;
  readonly api: Api;
  readonly baseUrl: (id: string) => string;
  readonly compat?: (source: ModelsDevModel) => Model<Api>["compat"];
  readonly excludes?: (id: string) => boolean;
}

const BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS = new Set(["anthropic.claude-opus-5"]);
const MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS = new Set(["gpt-5.6"]);

const fixed = (url: string) => (): string => url;

const DIRECT_PROVIDERS: readonly DirectProvider[] = [
  {
    source: "amazon-bedrock",
    provider: "amazon-bedrock",
    api: "bedrock-converse-stream",
    baseUrl: (id) =>
      id.startsWith("eu.")
        ? "https://bedrock-runtime.eu-central-1.amazonaws.com"
        : "https://bedrock-runtime.us-east-1.amazonaws.com",
    compat: (source) =>
      source.structured_output === true ? { supportsStrictMode: true } : undefined,
    excludes: (id) =>
      BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS.has(id) ||
      id.startsWith("ai21.jamba") ||
      id.startsWith("mistral.mistral-7b-instruct-v0"),
  },
  {
    source: "anthropic",
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: fixed("https://api.anthropic.com"),
  },
  {
    source: "openai",
    provider: "openai",
    api: "openai-responses",
    baseUrl: fixed("https://api.openai.com/v1"),
    excludes: (id) => MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS.has(id),
  },
  {
    source: "groq",
    provider: "groq",
    api: "openai-completions",
    baseUrl: fixed("https://api.groq.com/openai/v1"),
  },
  {
    source: "cerebras",
    provider: "cerebras",
    api: "openai-completions",
    baseUrl: fixed("https://api.cerebras.ai/v1"),
  },
  {
    source: "cloudflare-workers-ai",
    provider: "cloudflare-workers-ai",
    api: "openai-completions",
    baseUrl: fixed(CLOUDFLARE_WORKERS_AI_BASE_URL),
    compat: () => ({ sendSessionAffinityHeaders: true }),
  },
  {
    source: "xai",
    provider: "xai",
    api: "openai-responses",
    baseUrl: fixed("https://api.x.ai/v1"),
    compat: () => ({ supportsLongCacheRetention: false }),
  },
  {
    source: "meta",
    provider: "meta",
    api: "openai-responses",
    baseUrl: fixed("https://api.meta.ai/v1"),
  },
  {
    source: "huggingface",
    provider: "huggingface",
    api: "openai-completions",
    baseUrl: fixed("https://router.huggingface.co/v1"),
    compat: () => ({ supportsDeveloperRole: false }),
  },
];

function directProviderModels(
  { data, remember }: ModelsDevSource,
  direct: DirectProvider,
): Model<Api>[] {
  return toolModels(data[direct.source])
    .filter(([id]) => direct.excludes?.(id) !== true)
    .map(([id, source]) => {
      remember(direct.provider, id, source);
      return modelsDevModel({
        id,
        source,
        api: direct.api,
        provider: direct.provider,
        baseUrl: direct.baseUrl(id),
        compat: direct.compat?.(source),
      });
    });
}

export function directModels(source: ModelsDevSource): Model<Api>[] {
  return DIRECT_PROVIDERS.flatMap((direct) => directProviderModels(source, direct));
}

function mistralCacheRead(cost: ModelsDevModel["cost"]): number {
  if (cost?.cache_read !== undefined) return cost.cache_read;
  return cost?.input !== undefined && cost.input !== 0 && !Number.isNaN(cost.input)
    ? roundCost(cost.input * 0.1)
    : 0;
}

export function mistralModels({ data }: ModelsDevSource): Model<Api>[] {
  return toolModels(data["mistral"]).map(([id, source]) =>
    modelsDevModel({
      id,
      source,
      api: "mistral-conversations",
      provider: "mistral",
      baseUrl: "https://api.mistral.ai",
      thinkingLevelMap: getEffortThinkingLevelMap(source.reasoning_options ?? []),
      overrides: {
        cost: {
          input: source.cost?.input || 0,
          output: source.cost?.output || 0,
          cacheRead: mistralCacheRead(source.cost),
          cacheWrite: source.cost?.cache_write || 0,
        },
      },
    }),
  );
}
