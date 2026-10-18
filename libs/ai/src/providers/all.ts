import { Function } from "effect";

import { CLASSIFIER_MODELS, IMAGE_MODELS, MODELS } from "../models.generated.ts";
import { type CreateModelsOptions, createModels, type MutableModels } from "../models.ts";
import type {
  AnyModel,
  Api,
  ClassifierApi,
  ClassifierModel,
  ImageApi,
  ImageModel,
  Model,
} from "../types.ts";
import { builtinProviders } from "./builtin-providers.ts";
import modelDataManifest from "./data/.manifest.json" with { type: "json" };
import { radiusProvider } from "./radius.ts";

export { builtinProviders, radiusProvider };

export type BuiltinProvider = keyof typeof MODELS;

type BuiltinChatModelId<TProvider extends BuiltinProvider> = keyof (typeof MODELS)[TProvider];
type BuiltinImageModelId<TProvider extends BuiltinProvider> =
  keyof (typeof IMAGE_MODELS)[TProvider];
type BuiltinClassifierModelId<TProvider extends BuiltinProvider> =
  keyof (typeof CLASSIFIER_MODELS)[TProvider];
type CatalogApi<TEntry> = TEntry extends { api: infer TApi extends string } ? TApi : never;

export const getBuiltinModel: {
  <TProvider extends BuiltinProvider, TModelId extends BuiltinChatModelId<TProvider>>(
    modelId: TModelId,
  ): (provider: TProvider) => Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
  <TProvider extends BuiltinProvider, TModelId extends BuiltinChatModelId<TProvider>>(
    provider: TProvider,
    modelId: TModelId,
  ): Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
} = Function.dual(2, function <
  TProvider extends BuiltinProvider,
  TModelId extends BuiltinChatModelId<TProvider>,
>(provider: TProvider, modelId: TModelId): Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>> {
  return (MODELS as Record<string, Record<string, Model<Api>> | undefined>)[provider]?.[
    modelId as string
  ] as Model<CatalogApi<(typeof MODELS)[TProvider][TModelId]>>;
});

export const getBuiltinImageModel: {
  <TProvider extends BuiltinProvider, TModelId extends BuiltinImageModelId<TProvider>>(
    modelId: TModelId,
  ): (provider: TProvider) => ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>>;
  <TProvider extends BuiltinProvider, TModelId extends BuiltinImageModelId<TProvider>>(
    provider: TProvider,
    modelId: TModelId,
  ): ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>>;
} = Function.dual(2, function <
  TProvider extends BuiltinProvider,
  TModelId extends BuiltinImageModelId<TProvider>,
>(provider: TProvider, modelId: TModelId): ImageModel<
  CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>
> {
  return (IMAGE_MODELS as Record<string, Record<string, ImageModel<ImageApi>> | undefined>)[
    provider
  ]?.[modelId as string] as ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][TModelId]>>;
});

export const getBuiltinClassifierModel: {
  <TProvider extends BuiltinProvider, TModelId extends BuiltinClassifierModelId<TProvider>>(
    modelId: TModelId,
  ): (
    provider: TProvider,
  ) => ClassifierModel<CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>>;
  <TProvider extends BuiltinProvider, TModelId extends BuiltinClassifierModelId<TProvider>>(
    provider: TProvider,
    modelId: TModelId,
  ): ClassifierModel<CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>>;
} = Function.dual(2, function <
  TProvider extends BuiltinProvider,
  TModelId extends BuiltinClassifierModelId<TProvider>,
>(provider: TProvider, modelId: TModelId): ClassifierModel<
  CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>
> {
  return (
    CLASSIFIER_MODELS as Record<string, Record<string, ClassifierModel<ClassifierApi>> | undefined>
  )[provider]?.[modelId as string] as ClassifierModel<
    CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][TModelId]>
  >;
});

export function getBuiltinProviders(): BuiltinProvider[] {
  return Object.keys(MODELS) as BuiltinProvider[];
}

export function getBuiltinModelDataGeneratedAt(): number | undefined {
  const generatedAt = Date.parse(modelDataManifest.generatedAt);
  return Number.isNaN(generatedAt) ? undefined : generatedAt;
}

export function getBuiltinModels<TProvider extends BuiltinProvider>(
  provider: TProvider,
): Model<CatalogApi<(typeof MODELS)[TProvider][BuiltinChatModelId<TProvider>]>>[] {
  const models = (MODELS as Record<string, Record<string, Model<Api>> | undefined>)[provider];
  return Object.values(models ?? {}) as Model<
    CatalogApi<(typeof MODELS)[TProvider][BuiltinChatModelId<TProvider>]>
  >[];
}

export function getBuiltinImageModels<TProvider extends BuiltinProvider>(
  provider: TProvider,
): ImageModel<CatalogApi<(typeof IMAGE_MODELS)[TProvider][BuiltinImageModelId<TProvider>]>>[] {
  const models = (IMAGE_MODELS as Record<string, Record<string, ImageModel<ImageApi>> | undefined>)[
    provider
  ];
  return Object.values(models ?? {}) as ImageModel<
    CatalogApi<(typeof IMAGE_MODELS)[TProvider][BuiltinImageModelId<TProvider>]>
  >[];
}

export function getBuiltinClassifierModels<TProvider extends BuiltinProvider>(
  provider: TProvider,
): ClassifierModel<
  CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][BuiltinClassifierModelId<TProvider>]>
>[] {
  const models = (
    CLASSIFIER_MODELS as Record<string, Record<string, ClassifierModel<ClassifierApi>> | undefined>
  )[provider];
  return Object.values(models ?? {}) as ClassifierModel<
    CatalogApi<(typeof CLASSIFIER_MODELS)[TProvider][BuiltinClassifierModelId<TProvider>]>
  >[];
}

export function getAllBuiltinModels<TProvider extends BuiltinProvider>(
  provider: TProvider,
): AnyModel[] {
  return [
    ...getBuiltinModels(provider),
    ...getBuiltinImageModels(provider),
    ...getBuiltinClassifierModels(provider),
  ];
}

export function builtinModels(options?: CreateModelsOptions): MutableModels {
  const models = createModels(options);
  for (const provider of builtinProviders()) {
    models.setProvider(provider);
  }
  return models;
}
