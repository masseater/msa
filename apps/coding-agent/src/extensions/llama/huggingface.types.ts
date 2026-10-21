import type HuggingFaceClientClass from "./hugging-face-client.ts";

declare namespace huggingfaceTypes {
  interface HuggingFaceModel {
    id: string;
    downloads: number;
  }

  interface HuggingFaceQuantization {
    name: string;
    size?: number | undefined;
  }

  interface HuggingFaceModelDetails {
    id: string;
    gated: false | "auto" | "manual";
    quantizations: HuggingFaceQuantization[];
  }

  type HuggingFaceClient = (typeof HuggingFaceClientClass)["prototype"];
}

export type { huggingfaceTypes as default };
