// oxlint-disable-next-line import/no-unassigned-import -- 画像プロバイダをレジストリへ登録する副作用 import
import "./providers/images/register-builtins.ts";
import { getImagesApiProvider } from "./images-api-registry.ts";
import type {
  AssistantImages,
  ImageApi,
  ImageModel,
  ImagesContext,
  ProviderImagesOptions,
} from "./types.ts";

function resolveImagesApiProvider(api: ImageApi) {
  const provider = getImagesApiProvider(api);
  if (!provider) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

/**
 * Global image generation dispatched on `model.api` through the images api
 * registry. Auth must be passed explicitly via `options.apiKey`; prefer
 * `Models.generateImages()`, which resolves provider auth.
 *
 * @param {ImageModel<ImageApi>} model - image model the request targets
 * @param {ImagesContext} context - image request context
 * @param {ProviderImagesOptions} [options] - request options with auth
 * @returns {Promise<AssistantImages>} the generated images
 */
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
