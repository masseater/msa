import type typesModule from "../../src/types.types.ts";
import modelsDev from "./models-dev.ts";
import type modelsDevTypes from "./models-dev.types.ts";

const { modelsDevModel, toolModels } = modelsDev;

interface DirectProvider {
  readonly source: string;
  readonly provider: string;
  readonly api: typesModule.Api;
  readonly baseUrl: string;
  readonly excludes?: (id: string) => boolean;
}

const MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS = new Set(["gpt-5.6"]);

const DIRECT_PROVIDERS: readonly DirectProvider[] = [
  {
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    provider: "anthropic-api",
    source: "anthropic",
  },
  {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    excludes: (id) => MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS.has(id),
    provider: "openai",
    source: "openai",
  },
];

function directProviderModels(
  { data, remember }: modelsDevTypes.ModelsDevSource,
  direct: DirectProvider,
): typesModule.Model<typesModule.Api>[] {
  return toolModels(data[direct.source])
    .filter(([id]) => direct.excludes?.(id) !== true)
    .map(([id, source]) => {
      remember(direct.provider, id, source);
      return modelsDevModel({
        api: direct.api,
        baseUrl: direct.baseUrl,
        id,
        provider: direct.provider,
        source,
      });
    });
}

function directModels(
  source: modelsDevTypes.ModelsDevSource,
): typesModule.Model<typesModule.Api>[] {
  return DIRECT_PROVIDERS.flatMap((direct) => directProviderModels(source, direct));
}

export default directModels;
