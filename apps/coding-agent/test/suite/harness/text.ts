import type { ToolResultMessage } from "@msa/ai/compat";
import { Function } from "effect";

import type { Harness } from "./types.ts";

type MessageTextPart = { type: "text"; text: string };

export function getMessageText(message: unknown): string {
  if (
    message === undefined ||
    message === null ||
    typeof message !== "object" ||
    !("content" in message)
  ) {
    return "";
  }
  const content = (message as { content?: string | Array<{ type: string; text?: string }> })
    .content;
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is MessageTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function getUserTexts(harness: Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "user")
    .map((message) => getMessageText(message));
}

export function getAssistantTexts(harness: Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "assistant")
    .map((message) => getMessageText(message));
}

export const getToolResult: {
  (harness: Harness, toolName: string): ToolResultMessage;
  (toolName: string): (harness: Harness) => ToolResultMessage;
} = Function.dual(2, (harness: Harness, toolName: string): ToolResultMessage => {
  const result = harness.session.messages.findLast(
    (message): message is ToolResultMessage =>
      message.role === "toolResult" && message.toolName === toolName,
  );
  if (result === undefined) throw new Error(`No ${toolName} tool result`);
  return result;
});
