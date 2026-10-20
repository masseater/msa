import type openrouterApiTypes from "../src/providers/openrouter-api.types.ts";
import type typesModule from "../src/types.types.ts";
import type openrouterReasoningOptionsTypes from "./openrouter-reasoning-options.types.ts";

declare namespace openrouterCatalogTypes {
  interface OpenRouterModelListItem extends openrouterApiTypes.OpenRouterModel {
    name: string;
    supported_parameters?: string[];
    architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
    reasoning?: openrouterReasoningOptionsTypes.OpenRouterReasoningMetadata;
  }

  interface OpenRouterCatalog {
    chat: typesModule.Model<"anthropic-messages" | "openai-completions">[];
    images: typesModule.ImageModel<"openrouter-images">[];
    classifiers: typesModule.ClassifierModel<"typesafe-system-one">[];
  }
}

export type { openrouterCatalogTypes as default };
