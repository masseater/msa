import type { ProviderClassifier } from "../types.ts";

export const openAIDecisionsApi = (): ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./openai-decisions.ts").then((module) => module.classify(model, context, options)),
});
