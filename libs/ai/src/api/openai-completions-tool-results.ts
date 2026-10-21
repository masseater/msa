import type { ChatCompletionToolMessageParam } from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import openaiCompletionsConvertState from "./openai-completions-convert-state.ts";
import type openaiCompletionsConvertStateTypes from "./openai-completions-convert-state.types.ts";

const { isImageContentBlock, isTextContentBlock } = openaiCompletionsConvertState;
const { sanitizeSurrogates } = sanitizeUnicode;

function toolResultText(toolMsg: Extract<typesModule.Message, { role: "toolResult" }>): string {
  const textResult = toolMsg.content
    .filter(isTextContentBlock)
    .map((block) => block.text)
    .join("\n");
  if (textResult.length > 0) return textResult;
  return toolMsg.content.some((c) => c.type === "image")
    ? "(see attached image)"
    : "(no tool output)";
}

function pushToolResult(
  state: openaiCompletionsConvertStateTypes.ConvertState,
  toolMsg: Extract<typesModule.Message, { role: "toolResult" }>,
  imageBlocks: openaiCompletionsConvertStateTypes.ImageUrlPart[],
): void {
  const hasImages = toolMsg.content.some((c) => c.type === "image");
  const toolResultMsg: ChatCompletionToolMessageParam = {
    content: sanitizeSurrogates(toolResultText(toolMsg)),
    role: "tool",
    tool_call_id: toolMsg.toolCallId,
  };
  if (state.compat.requiresToolResultName && toolMsg.toolName !== "") {
    (toolResultMsg as any).name = toolMsg.toolName;
  }
  state.params.push(toolResultMsg);

  if (!hasImages || !state.model.input.includes("image")) return;
  for (const block of toolMsg.content) {
    if (isImageContentBlock(block)) {
      imageBlocks.push({
        image_url: {
          url: `data:${block.mimeType};base64,${block.data}`,
        },
        type: "image_url",
      });
    }
  }
}

function convertToolResults(input: {
  state: openaiCompletionsConvertStateTypes.ConvertState;
  messages: typesModule.Message[];
  index: number;
}): number {
  const { state, messages, index } = input;
  const imageBlocks: openaiCompletionsConvertStateTypes.ImageUrlPart[] = [];
  let next = index;
  for (let toolMsg = messages[next]; toolMsg?.role === "toolResult"; toolMsg = messages[++next]) {
    pushToolResult(state, toolMsg, imageBlocks);
  }

  if (imageBlocks.length > 0) {
    if (state.compat.requiresAssistantAfterToolResult) {
      state.params.push({ content: "I have processed the tool results.", role: "assistant" });
    }
    state.params.push({
      content: [{ text: "Attached image(s) from tool result:", type: "text" }, ...imageBlocks],
      role: "user",
    });
    state.lastRole = "user";
  } else {
    state.lastRole = "toolResult";
  }
  return next;
}

const openaiCompletionsToolResults = {
  convertToolResults,
};

export default openaiCompletionsToolResults;
