import type {
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import textModule from "../utils/text.ts";
import type openaiCompletionsConvertStateTypes from "./openai-completions-convert-state.types.ts";
import openaiCompletionsTools from "./openai-completions-tools.ts";

const { convertTools } = openaiCompletionsTools;
const { getSystemMessageText, renderSystemMessageUpdate } = textModule;
const { sanitizeSurrogates } = sanitizeUnicode;

interface ConvertSystemMessageInput {
  readonly state: openaiCompletionsConvertStateTypes.ConvertState;
  readonly msg: Extract<typesModule.Message, { role: "system" }>;
  readonly index: number;
}

function convertSystemMessage(input: ConvertSystemMessageInput): void {
  const { state, msg, index } = input;
  const addedTools = index > 0 && state.anchorsAdditions ? (msg.toolsAdded ?? []) : [];
  if (addedTools.length > 0) {
    const kimiToolMessage: openaiCompletionsConvertStateTypes.KimiToolSystemMessageParam = {
      role: "system",
      tools: convertTools({ compat: state.compat, tools: addedTools }),
    };
    state.params.push(kimiToolMessage as unknown as ChatCompletionMessageParam);
  }
  const text = index === 0 ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);
  if (text.length > 0) {
    state.params.push({ content: sanitizeSurrogates(text), role: state.instructionRole });
  }
}

function toUserContentPart(item: typesModule.TextContent | typesModule.ImageContent) {
  if (item.type === "text") {
    return {
      text: sanitizeSurrogates(item.text),
      type: "text",
    } satisfies ChatCompletionContentPartText;
  }
  return {
    image_url: {
      url: `data:${item.mimeType};base64,${item.data}`,
    },
    type: "image_url",
  } satisfies ChatCompletionContentPartImage;
}

function convertUserMessage(input: {
  state: openaiCompletionsConvertStateTypes.ConvertState;
  msg: Extract<typesModule.Message, { role: "user" }>;
}): boolean {
  const { state, msg } = input;
  if (typeof msg.content === "string") {
    state.params.push({ content: sanitizeSurrogates(msg.content), role: "user" });
    return true;
  }
  const content: ChatCompletionContentPart[] = msg.content
    .filter((item) => item.type !== "text" || item.text.length > 0)
    .map((item) => toUserContentPart(item));
  if (content.length === 0) return false;
  state.params.push({ content, role: "user" });
  return true;
}

const openaiCompletionsInstruction = {
  convertSystemMessage,
  convertUserMessage,
};

export default openaiCompletionsInstruction;
