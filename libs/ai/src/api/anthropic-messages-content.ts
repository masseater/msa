import type { ImageContent, TextContent } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";

type AnthropicImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
};

type AnthropicTextBlock = { type: "text"; text: string };

function toImageBlock(block: ImageContent): AnthropicImageBlock {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: block.data,
    },
  };
}

function convertContentBlocks(
  content: (TextContent | ImageContent)[],
): string | Array<AnthropicTextBlock | AnthropicImageBlock> {
  const hasImages = content.some((c) => c.type === "image");
  if (!hasImages) {
    return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
  }

  const blocks: Array<AnthropicTextBlock | AnthropicImageBlock> = content.map((block) =>
    block.type === "text"
      ? { type: "text", text: sanitizeSurrogates(block.text) }
      : toImageBlock(block),
  );

  const hasText = blocks.some((b) => b.type === "text");
  if (!hasText) {
    blocks.unshift({
      type: "text",
      text: "(see attached image)",
    });
  }

  return blocks;
}

export { convertContentBlocks };
