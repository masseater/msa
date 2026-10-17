import { getImagesApiProvider } from "./images-api-registry.ts";
import { registerBuiltInImagesApiProviders } from "./providers/images/register-builtins.ts";
import type {
  AssistantImages,
  ImageApi,
  ImageModel,
  ImagesContext,
  ProviderImagesOptions,
} from "./types.ts";

registerBuiltInImagesApiProviders();

function resolveImagesApiProvider(api: ImageApi) {
  const provider = getImagesApiProvider(api);
  if (provider === undefined) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

export function generateImages(
  model: ImageModel<ImageApi>,
  context: ImagesContext,
  options?: ProviderImagesOptions,
): Promise<AssistantImages> {
  try {
    return resolveImagesApiProvider(model.api).generateImages(model, context, options);
  } catch (error) {
    return Promise.reject(error);
  }
}
