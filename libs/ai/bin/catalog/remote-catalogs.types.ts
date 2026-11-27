import type { Effect } from "effect";

import type openrouterCatalogTypes from "../openrouter-catalog.types.ts";
import type modelsDevTypes from "./models-dev.types.ts";
import type upstreamTypes from "./upstream.types.ts";

declare namespace remoteCatalogsTypes {
  interface RemoteCatalogs {
    readonly fetchModelsDevCatalog: Effect.Effect<
      modelsDevTypes.ModelsDevCatalog,
      upstreamTypes.UpstreamError
    >;
    readonly fetchOpenRouterModels: (
      strict: boolean,
    ) => Effect.Effect<openrouterCatalogTypes.OpenRouterCatalog, upstreamTypes.UpstreamError>;
  }
}

export type { remoteCatalogsTypes as default };
