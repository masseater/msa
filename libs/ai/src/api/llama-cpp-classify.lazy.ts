import type typesModule from "../types.types.ts";

const llamaCppClassifyApi = (): typesModule.ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./llama-cpp-classify.ts").then((module) =>
      module.default.classify(model, context, options),
    ),
});

const llamaCppClassifyLazy = {
  llamaCppClassifyApi,
};

export default llamaCppClassifyLazy;
