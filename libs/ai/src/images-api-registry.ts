import { Function } from "effect";

import type imagesApiRegistryTypes from "./images-api-registry.types.ts";
import type typesModule from "./types.types.ts";
type RegisteredImagesApiProvider = {
  provider: imagesApiRegistryTypes.ImagesApiProviderInternal;
  sourceId?: string | undefined;
};

const imagesApiProviderRegistry = new Map<string, RegisteredImagesApiProvider>();

function wrapGenerateImages<TOptions extends typesModule.ImagesOptions>(
  api: typesModule.ImageApi,
  generateImages: typesModule.ImagesFunction<TOptions>,
): imagesApiRegistryTypes.ImagesApiFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched api: ${model.api} expected ${api}`);
    }
    return generateImages(model, context, options as TOptions);
  };
}

const registerImagesApiProvider: {
  <TApi extends typesModule.ImageApi, TOptions extends typesModule.ImagesOptions>(
    sourceId?: string,
  ): (provider: imagesApiRegistryTypes.ImagesApiProvider<TApi, TOptions>) => void;
  <TApi extends typesModule.ImageApi, TOptions extends typesModule.ImagesOptions>(
    provider: imagesApiRegistryTypes.ImagesApiProvider<TApi, TOptions>,
    sourceId?: string,
  ): void;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  function <TApi extends typesModule.ImageApi, TOptions extends typesModule.ImagesOptions>(
    provider: imagesApiRegistryTypes.ImagesApiProvider<TApi, TOptions>,
    sourceId?: string,
  ): void {
    imagesApiProviderRegistry.set(provider.api, {
      provider: {
        api: provider.api,
        generateImages: wrapGenerateImages(provider.api, provider.generateImages),
      },
      sourceId,
    });
  },
);

function getImagesApiProvider(
  api: typesModule.ImageApi,
): imagesApiRegistryTypes.ImagesApiProviderInternal | undefined {
  return imagesApiProviderRegistry.get(api)?.provider;
}

const imagesApiRegistry = {
  getImagesApiProvider,
  registerImagesApiProvider,
};

export default imagesApiRegistry;
