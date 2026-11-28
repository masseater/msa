import type { Effect } from "effect";

import type catalogBuildTypes from "./catalog-build.types.ts";

declare namespace catalogJsonOutputTypes {
  interface JsonCatalogOutput {
    readonly outputDir: string;
    readonly catalog: catalogBuildTypes.BuiltCatalog;
    readonly serialize: (value: unknown) => Effect.Effect<string>;
  }
}

export type { catalogJsonOutputTypes as default };
