import type { Effect } from "effect";

import type catalogDataTypes from "./catalog-data.types.ts";

declare namespace catalogWriteTypes {
  interface CatalogWrite {
    readonly packageRoot: string;
    readonly providerIds: readonly string[];
    readonly grouped: catalogDataTypes.GroupedCatalog;
    readonly generatedAt: string;
    readonly dataOnly: boolean;
    readonly serialize: (value: unknown) => Effect.Effect<string>;
  }
}

export type { catalogWriteTypes as default };
