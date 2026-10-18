import type {
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputItem,
  ResponseInputText,
} from "openai/resources/responses/responses.js";

import type {
  Api,
  ImageContent,
  Model,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";

const inputText = (text: string): ResponseInputText => ({
  type: "input_text",
  text: sanitizeSurrogates(text),
});

const inputImage = (image: ImageContent): ResponseInputImage => ({
  type: "input_image",
  detail: "auto",
  image_url: `data:${image.mimeType};base64,${image.data}`,
});

export function convertUserMessage(message: UserMessage): ResponseInputItem | undefined {
  if (typeof message.content === "string") {
    return { role: "user", content: [inputText(message.content)] };
  }
  const content = message.content.map((item): ResponseInputContent =>
    item.type === "text" ? inputText(item.text) : inputImage(item),
  );
  return content.length === 0 ? undefined : { role: "user", content };
}

function toolResultOutput<TApi extends Api>(
  model: Model<TApi>,
  content: readonly (TextContent | ImageContent)[],
): string | Array<ResponseInputText | ResponseInputImage> {
  const text = content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const images = content.filter((c): c is ImageContent => c.type === "image");
  if (images.length > 0 && model.input.includes("image")) {
    return [...(text.length > 0 ? [inputText(text)] : []), ...images.map(inputImage)];
  }
  if (text.length > 0) return sanitizeSurrogates(text);
  return images.length > 0 ? "(see attached image)" : "(no tool output)";
}

export interface ToolResultConversion<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly message: ToolResultMessage;
  readonly grammarToolInputProperties: ReadonlyMap<string, string> | undefined;
}

export function convertToolResultMessage<TApi extends Api>({
  model,
  message,
  grammarToolInputProperties,
}: ToolResultConversion<TApi>): ResponseInputItem {
  const [callId = ""] = message.toolCallId.split("|");
  const output = toolResultOutput(model, message.content);
  return grammarToolInputProperties?.has(message.toolName) === true
    ? { type: "custom_tool_call_output", call_id: callId, output }
    : { type: "function_call_output", call_id: callId, output };
}
