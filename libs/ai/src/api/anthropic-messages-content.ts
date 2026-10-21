import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";

const { sanitizeSurrogates } = sanitizeUnicode;

type AnthropicImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
};

type AnthropicTextBlock = { type: "text"; text: string };

function toImageBlock(block: typesModule.ImageContent): AnthropicImageBlock {
  return {
    source: {
      data: block.data,
      media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      type: "base64",
    },
    type: "image",
  };
}

function convertContentBlocks(
  content: (typesModule.TextContent | typesModule.ImageContent)[],
): string | Array<AnthropicTextBlock | AnthropicImageBlock> {
  const hasImages = content.some((c) => c.type === "image");
  if (!hasImages) {
    return sanitizeSurrogates(content.map((c) => (c as typesModule.TextContent).text).join("\n"));
  }

  const blocks: Array<AnthropicTextBlock | AnthropicImageBlock> = content.map((block) =>
    block.type === "text"
      ? { text: sanitizeSurrogates(block.text), type: "text" }
      : toImageBlock(block),
  );

  const hasText = blocks.some((b) => b.type === "text");
  if (!hasText) {
    blocks.unshift({
      text: "(see attached image)",
      type: "text",
    });
  }

  return blocks;
}

const anthropicMessagesContent = {
  convertContentBlocks,
};

export default anthropicMessagesContent;
