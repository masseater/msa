import { Function } from "effect";

import imagesApiRegistry from "./images-api-registry.ts";
import registerBuiltins from "./providers/images/register-builtins.ts";
import type typesModule from "./types.types.ts";

const { registerBuiltInImagesApiProviders } = registerBuiltins;
const { getImagesApiProvider } = imagesApiRegistry;

registerBuiltInImagesApiProviders();

function resolveImagesApiProvider(api: typesModule.ImageApi) {
  const provider = getImagesApiProvider(api);
  if (provider === undefined) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

const generateImages: {
  (
    context: typesModule.ImagesContext,
    options?: typesModule.ProviderImagesOptions,
  ): (model: typesModule.ImageModel<typesModule.ImageApi>) => Promise<typesModule.AssistantImages>;
  (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    context: typesModule.ImagesContext,
    options?: typesModule.ProviderImagesOptions,
  ): Promise<typesModule.AssistantImages>;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    context: typesModule.ImagesContext,
    options?: typesModule.ProviderImagesOptions,
  ): Promise<typesModule.AssistantImages> {
    try {
      return resolveImagesApiProvider(model.api).generateImages(model, context, options);
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const images = {
  generateImages,
};

export default images;
