import type typesModule from "../types.types.ts";
import type nodeLlamaCppClassifyTypes from "./node-llama-cpp-classify.types.ts";

const nodeLlamaCppClassifyApi = (
  config: nodeLlamaCppClassifyTypes.LocalClassifierConfig,
): typesModule.ProviderClassifier => {
  let classifier: Promise<typesModule.ProviderClassifier> | undefined;
  return {
    classify: (model, context, options) => {
      classifier ??= import("./node-llama-cpp-classify.ts").then((module) =>
        module.default.nodeLlamaCppClassifier(config),
      );
      return classifier.then((loaded) => loaded.classify(model, context, options));
    },
  };
};

const nodeLlamaCppClassifyLazy = {
  nodeLlamaCppClassifyApi,
};

export default nodeLlamaCppClassifyLazy;
