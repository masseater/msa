import type modelResolverTypes from "./model-resolver.types.ts";

declare namespace modelResolverInternalTypes {
  type ResolvedOrAmbiguous = Exclude<
    modelResolverTypes.ModelReferenceResult,
    { status: "not-found" }
  >;
}

export type { modelResolverInternalTypes as default };
