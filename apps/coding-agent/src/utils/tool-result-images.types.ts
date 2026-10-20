import type aiTypes from "@msa/ai/index.types";

declare namespace toolResultImagesTypes {
  type ToolResultContent = aiTypes.TextContent | aiTypes.ImageContent;

  interface NormalizeToolResultImagesOptions {
    autoResizeImages?: boolean;

    resizeOptions?: aiTypes.ModelImageResizeOptions;
  }
}

export type { toolResultImagesTypes as default };
