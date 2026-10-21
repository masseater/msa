import type {
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputItem,
  ResponseInputText,
} from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import type openaiResponsesUserInputTypes from "./openai-responses-user-input.types.ts";

const { sanitizeSurrogates } = sanitizeUnicode;

const inputText = (text: string): ResponseInputText => ({
  text: sanitizeSurrogates(text),
  type: "input_text",
});

const inputImage = (image: typesModule.ImageContent): ResponseInputImage => ({
  detail: "auto",
  image_url: `data:${image.mimeType};base64,${image.data}`,
  type: "input_image",
});

function convertUserMessage(message: typesModule.UserMessage): ResponseInputItem | undefined {
  if (typeof message.content === "string") {
    return { content: [inputText(message.content)], role: "user" };
  }
  const content = message.content.map((item): ResponseInputContent =>
    item.type === "text" ? inputText(item.text) : inputImage(item),
  );
  return content.length === 0 ? undefined : { content, role: "user" };
}

function toolResultOutput<TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  content: readonly (typesModule.TextContent | typesModule.ImageContent)[],
): string | Array<ResponseInputText | ResponseInputImage> {
  const text = content
    .filter((c): c is typesModule.TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const images = content.filter((c): c is typesModule.ImageContent => c.type === "image");
  if (images.length > 0 && model.input.includes("image")) {
    return [...(text.length > 0 ? [inputText(text)] : []), ...images.map(inputImage)];
  }
  if (text.length > 0) return sanitizeSurrogates(text);
  return images.length > 0 ? "(see attached image)" : "(no tool output)";
}

function convertToolResultMessage<TApi extends typesModule.Api>({
  model,
  message,
  grammarToolInputProperties,
}: openaiResponsesUserInputTypes.ToolResultConversion<TApi>): ResponseInputItem {
  const [callId = ""] = message.toolCallId.split("|");
  const output = toolResultOutput(model, message.content);
  return grammarToolInputProperties?.has(message.toolName) === true
    ? { call_id: callId, output, type: "custom_tool_call_output" }
    : { call_id: callId, output, type: "function_call_output" };
}

const openaiResponsesUserInput = {
  convertToolResultMessage,
  convertUserMessage,
};

export default openaiResponsesUserInput;
