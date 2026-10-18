import type { Message } from "@msa/ai/compat";

const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_TOOL_RESULT_CHARS = 800;

export function textFromContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === "text") parts.push(part.text);
    else if (part.type === "image") parts.push("[image attached — not visible to the backend]");
    else if (part.type === "toolCall") parts.push(`(called tool ${part.name})`);
  }
  return parts.filter((value) => value.length > 0).join("\n");
}

export function flattenTranscript(messages: readonly Message[]): string {
  const blocks: string[] = [];
  for (const message of messages) {
    let text = textFromContent(message.content).trim();
    if (!text) continue;
    if (message.role === "user") blocks.push(`User: ${text}`);
    else if (message.role === "assistant") blocks.push(`Assistant: ${text}`);
    else if (message.role === "toolResult") {
      if (text.length > MAX_TOOL_RESULT_CHARS) text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)} …`;
      blocks.push(`Tool result (${message.toolName}): ${text}`);
    }
  }
  const transcript = blocks.join("\n\n");
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  return `[earlier part of the conversation trimmed]\n\n${transcript.slice(
    transcript.length - MAX_TRANSCRIPT_CHARS,
  )}`;
}
