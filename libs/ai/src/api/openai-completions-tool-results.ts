import type { ChatCompletionToolMessageParam } from "openai/resources/chat/completions.js";

import type { Message } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import {
  isImageContentBlock,
  isTextContentBlock,
  type ConvertState,
  type ImageUrlPart,
} from "./openai-completions-convert-state.ts";

function toolResultText(toolMsg: Extract<Message, { role: "toolResult" }>): string {
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
  state: ConvertState,
  toolMsg: Extract<Message, { role: "toolResult" }>,
  imageBlocks: ImageUrlPart[],
): void {
  const hasImages = toolMsg.content.some((c) => c.type === "image");
  const toolResultMsg: ChatCompletionToolMessageParam = {
    role: "tool",
    content: sanitizeSurrogates(toolResultText(toolMsg)),
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
        type: "image_url",
        image_url: {
          url: `data:${block.mimeType};base64,${block.data}`,
        },
      });
    }
  }
}

function convertToolResults(input: {
  state: ConvertState;
  messages: Message[];
  index: number;
}): number {
  const { state, messages, index } = input;
  const imageBlocks: ImageUrlPart[] = [];
  let next = index;
  for (let toolMsg = messages[next]; toolMsg?.role === "toolResult"; toolMsg = messages[++next]) {
    pushToolResult(state, toolMsg, imageBlocks);
  }

  if (imageBlocks.length > 0) {
    if (state.compat.requiresAssistantAfterToolResult) {
      state.params.push({ role: "assistant", content: "I have processed the tool results." });
    }
    state.params.push({
      role: "user",
      content: [{ type: "text", text: "Attached image(s) from tool result:" }, ...imageBlocks],
    });
    state.lastRole = "user";
  } else {
    state.lastRole = "toolResult";
  }
  return next;
}

export { convertToolResults };
