import type typesModule from "../types.types.ts";
import hashModule from "../utils/hash.ts";

const { shortHash } = hashModule;

function isTextContentBlock(block: { type: string }): block is typesModule.TextContent {
  return block.type === "text";
}

function isThinkingContentBlock(block: { type: string }): block is typesModule.ThinkingContent {
  return block.type === "thinking";
}

function isToolCallBlock(block: { type: string }): block is typesModule.ToolCall {
  return block.type === "toolCall";
}

function isImageContentBlock(block: { type: string }): block is typesModule.ImageContent {
  return block.type === "image";
}

function hasToolHistory(messages: typesModule.Message[]): boolean {
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      return true;
    }
    if (msg.role === "assistant") {
      if (msg.content.some((block) => block.type === "toolCall")) {
        return true;
      }
    }
  }
  return false;
}

function normalizeToolCallId(input: {
  model: typesModule.Model<"openai-completions">;
  id: string;
}): string {
  const { model, id } = input;
  if (id.includes("|")) {
    const separatorIndex = id.indexOf("|");
    const callId = id
      .slice(0, separatorIndex)
      .replaceAll(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length));
    const itemId = id
      .slice(separatorIndex + 1)
      .replaceAll(/[^a-zA-Z0-9_-]/gu, (char) => "_".repeat(char.length));
    const combinedId = itemId.length > 0 ? `${callId}_${itemId}` : callId;
    if (combinedId.length <= 40) {
      return combinedId;
    }
    const hash = shortHash(id).slice(0, 8);
    const prefix = callId.slice(0, Math.max(1, 40 - hash.length - 1));
    return `${prefix}_${hash}`;
  }

  if (model.provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;
  return id;
}

const openaiCompletionsConvertState = {
  hasToolHistory,
  isImageContentBlock,
  isTextContentBlock,
  isThinkingContentBlock,
  isToolCallBlock,
  normalizeToolCallId,
};

export default openaiCompletionsConvertState;
