import type modelDataTypes from "../model-data.types.ts";
import type catalogBuildTypes from "./catalog-build.types.ts";

declare namespace catalogDataTypes {
  interface GroupedCatalog {
    readonly providerIds: readonly string[];
    readonly groups: Readonly<
      Record<string, Record<string, Record<string, catalogBuildTypes.CatalogEntry>>>
    >;
    readonly structure: modelDataTypes.ModelDataStructure;
  }

  interface CatalogGrouping {
    readonly packageRoot: string;
    readonly catalog: catalogBuildTypes.BuiltCatalog;
    readonly dataOnly: boolean;
  }
}

export type { catalogDataTypes as default };
