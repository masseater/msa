import { Function } from "effect";

import type typesModule from "../types.types.ts";

type Content =
  | typesModule.TextContent
  | typesModule.ImageContent
  | typesModule.ThinkingContent
  | typesModule.ToolCall;

const contentText: {
  (separator: string): (content: string | readonly Content[]) => string;
  (content: string | readonly Content[], separator: string): string;
} = Function.dual(2, function (content: string | readonly Content[], separator: string): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(separator);
});

function getSystemMessageText(message: typesModule.SystemMessage): string {
  const parts = [contentText(message.content, "\n")];
  for (const text of Object.values(message.sections ?? {})) {
    if (text !== null) parts.push(text);
  }
  return parts.filter((part) => part.length > 0).join("\n\n");
}

function renderSystemMessageUpdate(message: typesModule.SystemMessage): string {
  const parts: string[] = [];
  const text = contentText(message.content, "\n");
  if (text.length > 0) parts.push(text);
  for (const [name, value] of Object.entries(message.sections ?? {})) {
    parts.push(
      value === null
        ? `Removed system prompt section "${name}".`
        : `Updated system prompt section "${name}":\n\n${value}`,
    );
  }
  return parts.join("\n\n");
}

const textModule = {
  contentText,
  getSystemMessageText,
  renderSystemMessageUpdate,
};

export default textModule;
