import type typesModule from "../types.types.ts";

const openrouterImagesApi = (): typesModule.ProviderImages => ({
  generateImages: (model, context, options) =>
    import("./openrouter-images.ts").then((module) =>
      module.default.generateImages(model, context, options),
    ),
});

const openrouterImagesLazy = {
  openrouterImagesApi,
};

export default openrouterImagesLazy;
