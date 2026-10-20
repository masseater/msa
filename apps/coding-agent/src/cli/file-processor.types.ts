import type aiTypes from "@msa/ai/index.types";

declare namespace fileProcessorTypes {
  interface ProcessedFiles {
    text: string;
    images: aiTypes.ImageContent[];
  }

  interface ProcessFileOptions {
    autoResizeImages?: boolean;
  }
}

export type { fileProcessorTypes as default };
