import type { Model } from "../../src/types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

declare namespace modelsDevCatalogTypes {
  interface ModelsDevModels {
    readonly models: Model<any>[];
    readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
  }
}

export type { modelsDevCatalogTypes as default };
