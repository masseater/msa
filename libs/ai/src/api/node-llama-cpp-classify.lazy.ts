import type typesModule from "../types.types.ts";
import type nodeLlamaCppClassifyTypes from "./node-llama-cpp-classify.types.ts";

const nodeLlamaCppClassifyApi = (
  config: nodeLlamaCppClassifyTypes.LocalClassifierConfig,
): typesModule.ProviderClassifier => {
  let classifier: Promise<Required<typesModule.ProviderClassifier>> | undefined;
  const load = () =>
    (classifier ??= import("./node-llama-cpp-classify.ts").then((module) =>
      module.default.nodeLlamaCppClassifier(config),
    ));
  return {
    classify: (model, context, options) =>
      load().then((loaded) => loaded.classify(model, context, options)),
    prepare: (model) => load().then((loaded) => loaded.prepare(model)),
  };
};

const nodeLlamaCppClassifyLazy = {
  nodeLlamaCppClassifyApi,
};

export default nodeLlamaCppClassifyLazy;
