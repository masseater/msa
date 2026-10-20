import type typesModule from "../../src/types.types.ts";
import type modelDataTypes from "../model-data.types.ts";

declare namespace catalogBuildTypes {
  type CatalogEntry = typesModule.AnyModel & modelDataTypes.ModelCatalogEntry;

  interface CatalogSources {
    readonly chat: readonly typesModule.Model<any>[];
    readonly images: readonly typesModule.ImageModel<typesModule.ImageApi>[];
    readonly classifiers: readonly typesModule.ClassifierModel<typesModule.ClassifierApi>[];
  }

  interface ProviderCounts {
    readonly provider: string;
    readonly chat: number;
    readonly image: number;
    readonly classifier: number;
  }

  interface BuiltCatalog {
    readonly providerIds: readonly string[];
    readonly chatProviders: Readonly<
      Record<string, Record<string, typesModule.Model<typesModule.Api>>>
    >;
    readonly allProviders: Readonly<Record<string, CatalogEntry[]>>;
    readonly counts: readonly ProviderCounts[];
  }
}

export type { catalogBuildTypes as default };
