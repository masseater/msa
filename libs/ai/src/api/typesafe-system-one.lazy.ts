import type typesModule from "../types.types.ts";

const typesafeSystemOneApi = (): typesModule.ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./typesafe-system-one.ts").then((module) =>
      module.default.classify(model, context, options),
    ),
});

const typesafeSystemOneLazy = {
  typesafeSystemOneApi,
};

export default typesafeSystemOneLazy;
