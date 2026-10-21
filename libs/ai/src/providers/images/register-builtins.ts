import { Effect } from "effect";

import type openrouterImages from "../../api/openrouter-images.ts";
import imagesApiRegistry from "../../images-api-registry.ts";
import type typesModule from "../../types.types.ts";
import clock from "../../utils/clock.ts";
import errors from "../../utils/errors.ts";
import modelCallModule from "../../utils/model-call.ts";

const { toErrorMessage } = errors;
const { currentTimeMillis } = clock;
const { modelCall } = modelCallModule;
const { registerImagesApiProvider } = imagesApiRegistry;

interface OpenRouterImagesProviderModule {
  generateImages: typeof openrouterImages.generateImages;
}

let openRouterImagesProviderModulePromise: Promise<OpenRouterImagesProviderModule> | undefined;

function createLazyLoadErrorImages(
  model: typesModule.ImageModel<typesModule.ImageApi>,
  error: unknown,
): typesModule.AssistantImages {
  return {
    api: model.api,
    errorMessage: toErrorMessage(error),
    model: model.id,
    output: [],
    provider: model.provider,
    stopReason: "error",
    timestamp: currentTimeMillis(),
  };
}

function loadOpenRouterImagesProviderModule(): Promise<OpenRouterImagesProviderModule> {
  openRouterImagesProviderModulePromise ||= import("../../api/openrouter-images.ts").then(
    (module) => module.default as OpenRouterImagesProviderModule,
  );
  return openRouterImagesProviderModulePromise;
}

const generateImagesOpenRouter = modelCall<
  Parameters<typesModule.ImagesFunction<typesModule.ImagesOptions>>[0],
  Parameters<typesModule.ImagesFunction<typesModule.ImagesOptions>>[1],
  NonNullable<Parameters<typesModule.ImagesFunction<typesModule.ImagesOptions>>[2]>,
  ReturnType<typesModule.ImagesFunction<typesModule.ImagesOptions>>
>(
  (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    context: typesModule.ImagesContext,
    options?: typesModule.ImagesOptions,
  ) =>
    Effect.runPromise(
      Effect.promise(() => loadOpenRouterImagesProviderModule()).pipe(
        Effect.flatMap((module) =>
          Effect.promise(() => module.generateImages(model, context, options)),
        ),
        Effect.catchDefect((error) => Effect.succeed(createLazyLoadErrorImages(model, error))),
      ),
    ),
);

function registerBuiltInImagesApiProviders(): void {
  registerImagesApiProvider({
    api: "openrouter-images",
    generateImages: generateImagesOpenRouter,
  });
}

const registerBuiltins = {
  generateImagesOpenRouter,
  registerBuiltInImagesApiProviders,
};

export default registerBuiltins;
