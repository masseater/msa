import type typesModule from "./types.types.ts";

declare namespace imagesApiRegistryTypes {
  interface ImagesApiProviderInternal {
    api: typesModule.ImageApi;
    generateImages: ImagesApiFunction;
  }

  type ImagesApiFunction = (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    context: typesModule.ImagesContext,
    options?: typesModule.ImagesOptions,
  ) => Promise<typesModule.AssistantImages>;

  interface ImagesApiProvider<
    TApi extends typesModule.ImageApi = typesModule.ImageApi,
    TOptions extends typesModule.ImagesOptions = typesModule.ImagesOptions,
  > {
    api: TApi;
    generateImages: typesModule.ImagesFunction<TOptions>;
  }
}

export type { imagesApiRegistryTypes as default };
