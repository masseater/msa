import type { ProviderClassifier } from "../types.ts";

export const llamaCppClassifyApi = (): ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./llama-cpp-classify.ts").then((module) => module.classify(model, context, options)),
});
