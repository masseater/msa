import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

import type {
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../types.ts";
import { shortHash } from "../utils/hash.ts";
import type { ResolvedOpenAICompletionsCompat } from "./openai-completions-types.ts";

type KimiToolSystemMessageParam = {
  role: "system";
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
};

function isTextContentBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

function isThinkingContentBlock(block: { type: string }): block is ThinkingContent {
  return block.type === "thinking";
}

function isToolCallBlock(block: { type: string }): block is ToolCall {
  return block.type === "toolCall";
}

function isImageContentBlock(block: { type: string }): block is ImageContent {
  return block.type === "image";
}

function hasToolHistory(messages: Message[]): boolean {
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

interface ConvertCompletionsMessagesOptions {
  grammarToolInputProperties?: ReadonlyMap<string, string>;
}

type ImageUrlPart = { type: "image_url"; image_url: { url: string } };

interface ConvertState {
  readonly model: Model<"openai-completions">;
  readonly compat: ResolvedOpenAICompletionsCompat;
  readonly options: ConvertCompletionsMessagesOptions | undefined;
  readonly instructionRole: "developer" | "system";
  readonly anchorsAdditions: boolean;
  readonly params: ChatCompletionMessageParam[];
  lastRole: string | null;
}

function normalizeToolCallId(input: { model: Model<"openai-completions">; id: string }): string {
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

export {
  hasToolHistory,
  isImageContentBlock,
  isTextContentBlock,
  isThinkingContentBlock,
  isToolCallBlock,
  normalizeToolCallId,
  type ConvertCompletionsMessagesOptions,
  type ConvertState,
  type ImageUrlPart,
  type KimiToolSystemMessageParam,
};
