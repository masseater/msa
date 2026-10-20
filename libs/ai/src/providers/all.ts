import { Function } from "effect";

import modelsGenerated from "../models.generated.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import type typesModule from "../types.types.ts";
import type allTypes from "./all.types.ts";
import builtinProvidersModule from "./builtin-providers.ts";
import modelDataManifest from "./data/.manifest.json" with { type: "json" };

const { CLASSIFIER_MODELS, IMAGE_MODELS, MODELS } = modelsGenerated;
const { createModels } = modelsModule;
const { builtinProviders } = builtinProvidersModule;

type BuiltinChatModelId<TProvider extends allTypes.BuiltinProvider> =
  keyof (typeof MODELS)[TProvider];
type BuiltinImageModelId<TProvider extends allTypes.BuiltinProvider> =
  keyof (typeof IMAGE_MODELS)[TProvider];
type BuiltinClassifierModelId<TProvider extends allTypes.BuiltinProvider> =
  keyof (typeof CLASSIFIER_MODELS)[TProvider];
type CatalogApi<TEntry> = TEntry extends { api: infer TApi extends string } ? TApi : never;

const getBuiltinModel: {
  <TProvider extends allTypes.BuiltinProvider, TModelId extends BuiltinChatModelId<TProvider>>(
    modelId: TModelId,
  ): (provider: TProvider) => typesModule.Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
  <TProvider extends allTypes.BuiltinProvider, TModelId extends BuiltinChatModelId<TProvider>>(
    provider: TProvider,
    modelId: TModelId,
  ): typesModule.Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
} = Function.dual(2, function <
  TProvider extends allTypes.BuiltinProvider,
  TModelId extends BuiltinChatModelId<TProvider>,
>(provider: TProvider, modelId: TModelId): typesModule.Model<
  CatalogApi<(typeof MODELS)[TProvider][TModelId]>
> {
  return (MODELS as Record<string, Record<string, typesModule.Model<typesModule.Api>> | undefined>)[
    provider
  ]?.[modelId as string] as typesModule.Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
});

const getBuiltinImageModel: {
  <TProvider extends allTypes.BuiltinProvider, TModelId extends BuiltinImageModelId<TProvider>>(
    modelId: TModelId,
  ): (
    provider: TProvider,
  ) => typesModule.ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>>;
  <TProvider extends allTypes.BuiltinProvider, TModelId extends BuiltinImageModelId<TProvider>>(
    provider: TProvider,
    modelId: TModelId,
  ): typesModule.ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>>;
} = Function.dual(2, function <
  TProvider extends allTypes.BuiltinProvider,
  TModelId extends BuiltinImageModelId<TProvider>,
>(provider: TProvider, modelId: TModelId): typesModule.ImageModel<
  CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>
> {
  return (
    IMAGE_MODELS as Record<
      string,
      Record<string, typesModule.ImageModel<typesModule.ImageApi>> | undefined
    >
  )[provider]?.[modelId as string] as typesModule.ImageModel<
    CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>
  >;
});

const getBuiltinClassifierModel: {
  <
    TProvider extends allTypes.BuiltinProvider,
    TModelId extends BuiltinClassifierModelId<TProvider>,
  >(
    modelId: TModelId,
  ): (
    provider: TProvider,
  ) => typesModule.ClassifierModel<CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>>;
  <
    TProvider extends allTypes.BuiltinProvider,
    TModelId extends BuiltinClassifierModelId<TProvider>,
  >(
    provider: TProvider,
    modelId: TModelId,
  ): typesModule.ClassifierModel<CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>>;
} = Function.dual(2, function <
  TProvider extends allTypes.BuiltinProvider,
  TModelId extends BuiltinClassifierModelId<TProvider>,
>(provider: TProvider, modelId: TModelId): typesModule.ClassifierModel<
  CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>
> {
  return (
    CLASSIFIER_MODELS as Record<
      string,
      Record<string, typesModule.ClassifierModel<typesModule.ClassifierApi>> | undefined
    >
  )[provider]?.[modelId as string] as typesModule.ClassifierModel<
    CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>
  >;
});

function getBuiltinProviders(): allTypes.BuiltinProvider[] {
  return Object.keys(MODELS) as allTypes.BuiltinProvider[];
}

function getBuiltinModelDataGeneratedAt(): number | undefined {
  const generatedAt = Date.parse(modelDataManifest.generatedAt);
  return Number.isNaN(generatedAt) ? undefined : generatedAt;
}

function getBuiltinModels<TProvider extends allTypes.BuiltinProvider>(
  provider: TProvider,
): typesModule.Model<CatalogApi<(typeof MODELS)[TProvider][BuiltinChatModelId<TProvider>]>>[] {
  const models = (
    MODELS as Record<string, Record<string, typesModule.Model<typesModule.Api>> | undefined>
  )[provider];
  return Object.values(models ?? {}) as typesModule.Model<
    CatalogApi<(typeof MODELS)[TProvider][BuiltinChatModelId<TProvider>]>
  >[];
}

function getBuiltinImageModels<TProvider extends allTypes.BuiltinProvider>(
  provider: TProvider,
): typesModule.ImageModel<
  CatalogApi<(typeof IMAGE_MODELS)[TProvider][BuiltinImageModelId<TProvider>]>
>[] {
  const models = (
    IMAGE_MODELS as Record<
      string,
      Record<string, typesModule.ImageModel<typesModule.ImageApi>> | undefined
    >
  )[provider];
  return Object.values(models ?? {}) as typesModule.ImageModel<
    CatalogApi<(typeof IMAGE_MODELS)[TProvider][BuiltinImageModelId<TProvider>]>
  >[];
}

function getBuiltinClassifierModels<TProvider extends allTypes.BuiltinProvider>(
  provider: TProvider,
): typesModule.ClassifierModel<
  CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][BuiltinClassifierModelId<TProvider>]>
>[] {
  const models = (
    CLASSIFIER_MODELS as Record<
      string,
      Record<string, typesModule.ClassifierModel<typesModule.ClassifierApi>> | undefined
    >
  )[provider];
  return Object.values(models ?? {}) as typesModule.ClassifierModel<
    CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][BuiltinClassifierModelId<TProvider>]>
  >[];
}

function getAllBuiltinModels<TProvider extends allTypes.BuiltinProvider>(
  provider: TProvider,
): typesModule.AnyModel[] {
  return [
    ...getBuiltinModels(provider),
    ...getBuiltinImageModels(provider),
    ...getBuiltinClassifierModels(provider),
  ];
}

function builtinModels(options?: modelsTypes.CreateModelsOptions): modelsTypes.MutableModels {
  const models = createModels(options);
  for (const provider of builtinProviders()) {
    models.setProvider(provider);
  }
  return models;
}

const all = {
  builtinModels,
  builtinProviders: builtinProvidersModule.builtinProviders,
  getAllBuiltinModels,
  getBuiltinClassifierModel,
  getBuiltinClassifierModels,
  getBuiltinImageModel,
  getBuiltinImageModels,
  getBuiltinModel,
  getBuiltinModelDataGeneratedAt,
  getBuiltinModels,
  getBuiltinProviders,
};

export default all;
