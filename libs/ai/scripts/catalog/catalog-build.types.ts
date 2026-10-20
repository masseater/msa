import type {
  AnyModel,
  Api,
  ClassifierApi,
  ClassifierModel,
  ImageApi,
  ImageModel,
  Model,
} from "../../src/types.ts";
import type modelDataTypes from "../model-data.types.ts";

declare namespace catalogBuildTypes {
  type CatalogEntry = AnyModel & modelDataTypes.ModelCatalogEntry;

  interface CatalogSources {
    readonly chat: readonly Model<any>[];
    readonly images: readonly ImageModel<ImageApi>[];
    readonly classifiers: readonly ClassifierModel<ClassifierApi>[];
  }

  interface ProviderCounts {
    readonly provider: string;
    readonly chat: number;
    readonly image: number;
    readonly classifier: number;
  }

  interface BuiltCatalog {
    readonly providerIds: readonly string[];
    readonly chatProviders: Readonly<Record<string, Record<string, Model<Api>>>>;
    readonly allProviders: Readonly<Record<string, CatalogEntry[]>>;
    readonly counts: readonly ProviderCounts[];
  }
}

export type { catalogBuildTypes as default };
