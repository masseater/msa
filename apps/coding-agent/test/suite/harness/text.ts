import type compatTypes from "@msa/ai/compat.types";
import { Function } from "effect";

import type typesModule from "./types.ts";

type MessageTextPart = { type: "text"; text: string };

function getMessageText(message: unknown): string {
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

function getUserTexts(harness: typesModule.Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "user")
    .map((message) => getMessageText(message));
}

function getAssistantTexts(harness: typesModule.Harness): string[] {
  return harness.session.messages
    .filter((message) => message.role === "assistant")
    .map((message) => getMessageText(message));
}

const getToolResult: {
  (harness: typesModule.Harness, toolName: string): compatTypes.ToolResultMessage;
  (toolName: string): (harness: typesModule.Harness) => compatTypes.ToolResultMessage;
} = Function.dual(
  2,
  (harness: typesModule.Harness, toolName: string): compatTypes.ToolResultMessage => {
    const result = harness.session.messages.findLast(
      (message): message is compatTypes.ToolResultMessage =>
        message.role === "toolResult" && message.toolName === toolName,
    );
    if (result === undefined) throw new Error(`No ${toolName} tool result`);
    return result;
  },
);

const text = {
  getAssistantTexts,
  getMessageText,
  getToolResult,
  getUserTexts,
};

export default text;
