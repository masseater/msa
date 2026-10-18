import type { Api, Model } from "../../src/types.ts";
import { modelsDevModel, type ModelsDevSource, toolModels } from "./models-dev.ts";

interface DirectProvider {
  readonly source: string;
  readonly provider: string;
  readonly api: Api;
  readonly baseUrl: string;
  readonly excludes?: (id: string) => boolean;
}

const MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS = new Set(["gpt-5.6"]);

const DIRECT_PROVIDERS: readonly DirectProvider[] = [
  {
    source: "anthropic",
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
  },
  {
    source: "openai",
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    excludes: (id) => MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS.has(id),
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
        baseUrl: direct.baseUrl,
      });
    });
}

export function directModels(source: ModelsDevSource): Model<Api>[] {
  return DIRECT_PROVIDERS.flatMap((direct) => directProviderModels(source, direct));
}
