import type { ProviderImages } from "../types.ts";

export const openrouterImagesApi = (): ProviderImages => ({
  generateImages: (model, context, options) =>
    import("./openrouter-images.ts").then((module) =>
      module.generateImages(model, context, options),
    ),
});
