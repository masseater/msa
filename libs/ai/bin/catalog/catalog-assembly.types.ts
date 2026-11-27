import type typesModule from "../../src/types.types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

declare namespace catalogAssemblyTypes {
  interface CatalogAssembly {
    readonly upstream: readonly typesModule.Model<any>[];
    readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
  }
}

export type { catalogAssemblyTypes as default };
