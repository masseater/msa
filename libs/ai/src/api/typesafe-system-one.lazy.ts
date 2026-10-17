import type { ProviderClassifier } from "../types.ts";

export const typesafeSystemOneApi = (): ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./typesafe-system-one.ts").then((module) => module.classify(model, context, options)),
});
