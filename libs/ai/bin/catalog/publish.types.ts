import type catalogBuildTypes from "./catalog-build.types.ts";
import type optionsTypes from "./options.types.ts";

declare namespace publishTypes {
  interface CatalogPublication {
    readonly packageRoot: string;
    readonly catalog: catalogBuildTypes.BuiltCatalog;
    readonly options: optionsTypes.GeneratorOptions;
  }
}

export type { publishTypes as default };
