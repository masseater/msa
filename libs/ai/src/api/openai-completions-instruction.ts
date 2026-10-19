import type {
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.js";

import type { ImageContent, Message, TextContent } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText, renderSystemMessageUpdate } from "../utils/text.ts";
import type {
  ConvertState,
  KimiToolSystemMessageParam,
} from "./openai-completions-convert-state.ts";
import { convertTools } from "./openai-completions-tools.ts";

interface ConvertSystemMessageInput {
  readonly state: ConvertState;
  readonly msg: Extract<Message, { role: "system" }>;
  readonly index: number;
}

function convertSystemMessage(input: ConvertSystemMessageInput): void {
  const { state, msg, index } = input;
  const addedTools = index > 0 && state.anchorsAdditions ? (msg.toolsAdded ?? []) : [];
  if (addedTools.length > 0) {
    const kimiToolMessage: KimiToolSystemMessageParam = {
      role: "system",
      tools: convertTools({ tools: addedTools, compat: state.compat }),
    };
    state.params.push(kimiToolMessage as unknown as ChatCompletionMessageParam);
  }
  const text = index === 0 ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);
  if (text.length > 0) {
    state.params.push({ role: state.instructionRole, content: sanitizeSurrogates(text) });
  }
}

function toUserContentPart(item: TextContent | ImageContent) {
  if (item.type === "text") {
    return {
      type: "text",
      text: sanitizeSurrogates(item.text),
    } satisfies ChatCompletionContentPartText;
  }
  return {
    type: "image_url",
    image_url: {
      url: `data:${item.mimeType};base64,${item.data}`,
    },
  } satisfies ChatCompletionContentPartImage;
}

function convertUserMessage(input: {
  state: ConvertState;
  msg: Extract<Message, { role: "user" }>;
}): boolean {
  const { state, msg } = input;
  if (typeof msg.content === "string") {
    state.params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
    return true;
  }
  const content: ChatCompletionContentPart[] = msg.content
    .filter((item) => item.type !== "text" || item.text.length > 0)
    .map((item) => toUserContentPart(item));
  if (content.length === 0) return false;
  state.params.push({ role: "user", content });
  return true;
}

export { convertSystemMessage, convertUserMessage };
