import type {
  ClassifierApi,
  ClassifierModel,
  ImageApi,
  ImageModel,
  Model,
} from "../../src/types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

declare namespace upstreamModelsTypes {
  interface UpstreamModels {
    readonly chat: readonly Model<any>[];
    readonly images: readonly ImageModel<ImageApi>[];
    readonly classifiers: readonly ClassifierModel<ClassifierApi>[];
    readonly reasoning: modelsDevTypes.ReasoningOptionsRegistry;
  }
}

export type { upstreamModelsTypes as default };
