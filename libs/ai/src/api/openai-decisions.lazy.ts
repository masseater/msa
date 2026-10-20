import type typesModule from "../types.types.ts";

const openAIDecisionsApi = (): typesModule.ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./openai-decisions.ts").then((module) =>
      module.default.classify(model, context, options),
    ),
});

const openaiDecisionsLazy = {
  openAIDecisionsApi,
};

export default openaiDecisionsLazy;
