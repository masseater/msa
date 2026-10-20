import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type compatTypes from "@msa/ai/compat.types";

import platformNode from "../platform-node.ts";
import transcript from "./transcript.ts";

const { sha256Hex } = platformNode;
const { textFromContent } = transcript;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const replyKey = (content: compatTypes.Message["content"]): string =>
  sha256Hex(textFromContent(content));

function toAnthropicContent(content: compatTypes.UserMessage["content"]): ContentBlockParam[] {
  if (typeof content === "string") return [{ text: content, type: "text" }];
  return content.map((part) =>
    part.type === "text"
      ? { text: part.text, type: "text" }
      : {
          source: { data: part.data, media_type: part.mimeType as ImageMediaType, type: "base64" },
          type: "image",
        },
  );
}

function toCallToolResult(result: compatTypes.ToolResultMessage): CallToolResult {
  const content = result.content.map((part) =>
    part.type === "image"
      ? { data: part.data, mimeType: part.mimeType, type: "image" as const }
      : { text: part.text, type: "text" as const },
  );
  return { content, isError: result.isError };
}

const claudeCodeContent = { replyKey, sha256Hex, toAnthropicContent, toCallToolResult };

export default claudeCodeContent;
