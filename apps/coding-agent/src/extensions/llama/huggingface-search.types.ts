import type HuggingFaceSearchClass from "./huggingface-search.ts";

declare namespace huggingfaceSearchTypes {
  type HuggingFaceSearch = (typeof HuggingFaceSearchClass)["prototype"];
}

export type { huggingfaceSearchTypes as default };
