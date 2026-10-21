import type aiTypes from "@msa/ai/index.types";

declare namespace renderUtilsTypes {
  type ToolRenderResultLike<TDetails> = {
    content: (aiTypes.TextContent | aiTypes.ImageContent)[];
    details: TDetails;
  };
}

export type { renderUtilsTypes as default };
