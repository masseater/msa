import type aiTypes from "@msa/ai/index.types";

declare namespace printModeTypes {
  interface PrintModeOptions {
    mode: "text" | "json";
    messages?: string[] | undefined;
    initialMessage?: string | undefined;
    initialImages?: aiTypes.ImageContent[] | undefined;
  }
}

export type { printModeTypes as default };
