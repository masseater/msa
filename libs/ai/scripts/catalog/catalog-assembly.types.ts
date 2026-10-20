import type { Model } from "../../src/types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

declare namespace catalogAssemblyTypes {
  interface CatalogAssembly {
    readonly upstream: readonly Model<any>[];
    readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
  }
}

export type { catalogAssemblyTypes as default };
