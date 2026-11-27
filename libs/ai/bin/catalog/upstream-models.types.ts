import type typesModule from "../../src/types.types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

declare namespace upstreamModelsTypes {
  interface UpstreamModels {
    readonly chat: readonly typesModule.Model<any>[];
    readonly images: readonly typesModule.ImageModel<typesModule.ImageApi>[];
    readonly classifiers: readonly typesModule.ClassifierModel<typesModule.ClassifierApi>[];
    readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
  }
}

export type { upstreamModelsTypes as default };
