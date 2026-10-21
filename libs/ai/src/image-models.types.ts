import type modelsGenerated from "./models.generated.ts";

declare namespace imageModelsTypes {
  type Catalog = typeof modelsGenerated.IMAGE_MODELS;

  type ImageModelIds<TProvider extends keyof Catalog> = keyof Catalog[TProvider];

  type BuiltinImageProvider = {
    [TProvider in keyof Catalog]: [ImageModelIds<TProvider>] extends [never] ? never : TProvider;
  }[keyof Catalog];
}

export type { imageModelsTypes as default };
