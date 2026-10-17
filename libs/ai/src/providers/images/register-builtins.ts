import { Effect } from "effect";

import type { generateImages as generateImagesOpenRouterFunction } from "../../api/openrouter-images.ts";
import { registerImagesApiProvider } from "../../images-api-registry.ts";
import type {
  AssistantImages,
  ImageApi,
  ImageModel,
  ImagesContext,
  ImagesFunction,
  ImagesOptions,
} from "../../types.ts";
import { currentTimeMillis } from "../../utils/clock.ts";
import { toErrorMessage } from "../../utils/errors.ts";

interface OpenRouterImagesProviderModule {
  generateImages: typeof generateImagesOpenRouterFunction;
}

let openRouterImagesProviderModulePromise: Promise<OpenRouterImagesProviderModule> | undefined;

function createLazyLoadErrorImages(model: ImageModel<ImageApi>, error: unknown): AssistantImages {
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    stopReason: "error",
    errorMessage: toErrorMessage(error),
    timestamp: currentTimeMillis(),
  };
}

function loadOpenRouterImagesProviderModule(): Promise<OpenRouterImagesProviderModule> {
  openRouterImagesProviderModulePromise ||= import("../../api/openrouter-images.ts").then(
    (module) => module as OpenRouterImagesProviderModule,
  );
  return openRouterImagesProviderModulePromise;
}

export const generateImagesOpenRouter: ImagesFunction<ImagesOptions> = (
  model: ImageModel<ImageApi>,
  context: ImagesContext,
  options?: ImagesOptions,
) =>
  Effect.runPromise(
    Effect.promise(() => loadOpenRouterImagesProviderModule()).pipe(
      Effect.flatMap((module) =>
        Effect.promise(() => module.generateImages(model, context, options)),
      ),
      Effect.catchDefect((error) => Effect.succeed(createLazyLoadErrorImages(model, error))),
    ),
  );

export function registerBuiltInImagesApiProviders(): void {
  registerImagesApiProvider({
    api: "openrouter-images",
    generateImages: generateImagesOpenRouter,
  });
}
