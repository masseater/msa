import type { OpenRouterModel } from "../src/providers/openrouter-api.ts";
import type { ClassifierModel, ImageModel, Model } from "../src/types.ts";
import type openrouterReasoningOptionsTypes from "./openrouter-reasoning-options.types.ts";

declare namespace openrouterCatalogTypes {
  interface OpenRouterModelListItem extends OpenRouterModel {
    name: string;
    supported_parameters?: string[];
    architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
    reasoning?: openrouterReasoningOptionsTypes.OpenRouterReasoningMetadata;
  }

  interface OpenRouterCatalog {
    chat: Model<"anthropic-messages" | "openai-completions">[];
    images: ImageModel<"openrouter-images">[];
    classifiers: ClassifierModel<"typesafe-system-one">[];
  }
}

export type { openrouterCatalogTypes as default };
