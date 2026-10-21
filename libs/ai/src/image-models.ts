import { Function } from "effect";

import type imageModelsTypes from "./image-models.types.ts";
import modelsGenerated from "./models.generated.ts";
import type typesModule from "./types.types.ts";

const { IMAGE_MODELS } = modelsGenerated;

type BuiltinImageModel<
  TProvider extends imageModelsTypes.BuiltinImageProvider,
  TModelId extends imageModelsTypes.ImageModelIds<TProvider>,
> =
  imageModelsTypes.Catalog[TProvider][TModelId] extends typesModule.ImageModel<
    infer TApi extends typesModule.ImageApi
  >
    ? typesModule.ImageModel<TApi>
    : never;

const imageModelsByProvider = new Map<
  string,
  Map<string, typesModule.ImageModel<typesModule.ImageApi>>
>();
for (const [provider, models] of Object.entries(IMAGE_MODELS)) {
  const imageModels = new Map<string, typesModule.ImageModel<typesModule.ImageApi>>();
  for (const model of Object.values(
    models as Record<string, typesModule.ImageModel<typesModule.ImageApi>>,
  )) {
    imageModels.set(model.id, model);
  }
  if (imageModels.size > 0) imageModelsByProvider.set(provider, imageModels);
}

const getImageModel: {
  <
    TProvider extends imageModelsTypes.BuiltinImageProvider,
    TModelId extends imageModelsTypes.ImageModelIds<TProvider>,
  >(
    modelId: TModelId,
  ): (provider: TProvider) => BuiltinImageModel<TProvider, TModelId>;
  <
    TProvider extends imageModelsTypes.BuiltinImageProvider,
    TModelId extends imageModelsTypes.ImageModelIds<TProvider>,
  >(
    provider: TProvider,
    modelId: TModelId,
  ): BuiltinImageModel<TProvider, TModelId>;
} = Function.dual(2, function <
  TProvider extends imageModelsTypes.BuiltinImageProvider,
  TModelId extends imageModelsTypes.ImageModelIds<TProvider>,
>(provider: TProvider, modelId: TModelId): BuiltinImageModel<TProvider, TModelId> {
  return imageModelsByProvider.get(provider)?.get(modelId as string) as BuiltinImageModel<
    TProvider,
    TModelId
  >;
});

function getImageProviders(): imageModelsTypes.BuiltinImageProvider[] {
  return Array.from(imageModelsByProvider.keys()) as imageModelsTypes.BuiltinImageProvider[];
}

function getImageModels<TProvider extends imageModelsTypes.BuiltinImageProvider>(
  provider: TProvider,
): BuiltinImageModel<TProvider, imageModelsTypes.ImageModelIds<TProvider>>[] {
  const models = imageModelsByProvider.get(provider);
  return models === undefined
    ? []
    : (Array.from(models.values()) as BuiltinImageModel<
        TProvider,
        imageModelsTypes.ImageModelIds<TProvider>
      >[]);
}

const imageModelsModule = {
  getImageModel,
  getImageModels,
  getImageProviders,
};

export default imageModelsModule;
