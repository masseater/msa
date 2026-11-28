import type typesModule from "../../src/types.types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

declare namespace modelsDevCatalogTypes {
  interface ModelsDevModels {
    readonly models: typesModule.Model<any>[];
    readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
  }
}

export type { modelsDevCatalogTypes as default };
