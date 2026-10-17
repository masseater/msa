import { Function } from "effect";

import { IMAGE_MODELS } from "./models.generated.ts";
import type { ImageApi, ImageModel } from "./types.ts";

type Catalog = typeof IMAGE_MODELS;
type ImageModelIds<TProvider extends keyof Catalog> = keyof Catalog[TProvider];

export type BuiltinImageProvider = {
  [TProvider in keyof Catalog]: [ImageModelIds<TProvider>] extends [never] ? never : TProvider;
}[keyof Catalog];

type BuiltinImageModel<
  TProvider extends BuiltinImageProvider,
  TModelId extends ImageModelIds<TProvider>,
> =
  Catalog[TProvider][TModelId] extends ImageModel<infer TApi extends ImageApi>
    ? ImageModel<TApi>
    : never;

const imageModelsByProvider = new Map<string, Map<string, ImageModel<ImageApi>>>();
for (const [provider, models] of Object.entries(IMAGE_MODELS)) {
  const imageModels = new Map<string, ImageModel<ImageApi>>();
  for (const model of Object.values(models as Record<string, ImageModel<ImageApi>>)) {
    imageModels.set(model.id, model);
  }
  if (imageModels.size > 0) imageModelsByProvider.set(provider, imageModels);
}

export const getImageModel: {
  <TProvider extends BuiltinImageProvider, TModelId extends ImageModelIds<TProvider>>(
    modelId: TModelId,
  ): (provider: TProvider) => BuiltinImageModel<TProvider, TModelId>;
  <TProvider extends BuiltinImageProvider, TModelId extends ImageModelIds<TProvider>>(
    provider: TProvider,
    modelId: TModelId,
  ): BuiltinImageModel<TProvider, TModelId>;
} = Function.dual(2, function <
  TProvider extends BuiltinImageProvider,
  TModelId extends ImageModelIds<TProvider>,
>(provider: TProvider, modelId: TModelId): BuiltinImageModel<TProvider, TModelId> {
  return imageModelsByProvider.get(provider)?.get(modelId as string) as BuiltinImageModel<
    TProvider,
    TModelId
  >;
});

export function getImageProviders(): BuiltinImageProvider[] {
  return Array.from(imageModelsByProvider.keys()) as BuiltinImageProvider[];
}

export function getImageModels<TProvider extends BuiltinImageProvider>(
  provider: TProvider,
): BuiltinImageModel<TProvider, ImageModelIds<TProvider>>[] {
  const models = imageModelsByProvider.get(provider);
  return models === undefined
    ? []
    : (Array.from(models.values()) as BuiltinImageModel<TProvider, ImageModelIds<TProvider>>[]);
}
